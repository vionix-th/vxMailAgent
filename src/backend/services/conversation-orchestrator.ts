import { ConversationThread, PromptMessage, ProviderEvent, Director, Agent, WorkspaceItem, ApiConfig, AgentThread } from '../../shared/types';
import { runAgentConversation, ensureAgentThread, AgentConversationPersistence } from './orchestration-agent';
import { createToolHandler } from '../toolCalls';
import { requireContext, requireRepos, ensureContext } from '../utils/repo-access';
import logger from './logger';
import { CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { ConversationStepLogger, ProviderEventLogger } from './logging';
import type { ContextInput, UserScopedContext } from '../utils/repo-access';
import type { LiveRepos } from '../liveRepos';
import { conversationEngine } from './engine';
import { newId } from '../utils/id';
import { repoAppendMessage, repoAppendMessages, repoFinalizeThreadStatus, repoGetThreadById } from './conversation-mutations';
import { extractLastUserContent } from '../utils/message-transformers';
import { InvalidAgentConfigError, ValidationError } from './error-handler';
import { serializeApiConfig, ApiConfigView } from './apiConfigSerializer';
import { resolveAgentToolDescriptors, resolveDirectorToolDescriptors } from './tool-config-service';

export interface ConversationContext {
  thread: ConversationThread;
  director?: Director;
  agent?: Agent;
  agents: Agent[];
  apiConfigs: ApiConfig[];
  prompts: any[];
  traceId: string;
}

export interface UserRequest {
  repos: LiveRepos;
  context: UserScopedContext;
  traceId?: string;
}

export function createUserRequest(middlewareReq: ContextInput, repos: LiveRepos): UserRequest {
  const scoped = ensureContext(middlewareReq);
  // Prefer traceId from ensured context (set by middleware),
  // fall back to header when an Express request is passed directly.
  const traceHeader = (middlewareReq as any)?.headers?.['x-trace-id'];
  const traceFromHeader = Array.isArray(traceHeader) ? traceHeader[0] : traceHeader;
  const traceId = typeof scoped.traceId === 'string' && scoped.traceId.trim()
    ? scoped.traceId
    : (typeof traceFromHeader === 'string' ? traceFromHeader : undefined);
  return {
    repos,
    context: scoped,
    traceId,
  };
}

export interface ConversationStepResult {
  updatedThread: ConversationThread;
  success: boolean;
  shouldContinue: boolean;
  error?: string;
}

/**
 * Orchestrates Director and Agent thread execution: drives steps, processes Director tool calls,
 * spawns Agent threads, and persists transcripts and provider diagnostics.
 */
export class ConversationOrchestrator {
  private activeSteps = new Map<string, { timeoutId: NodeJS.Timeout; startTime: number; emailId: string; directorId: string }>();
  private stepLogger: ConversationStepLogger;
  private providerLogger: ProviderEventLogger;
  private runId: string;
  private accountId: string;

  constructor(req: ContextInput | undefined, runId: string, accountId: string) {
    if (!runId) throw new Error('runId required');
    if (!accountId) throw new Error('accountId required');
    this.runId = runId;
    this.accountId = accountId;
    this.stepLogger = new ConversationStepLogger(req, this.runId, this.accountId);
    this.providerLogger = new ProviderEventLogger(req);
  }

  /** Determine if the director loop should continue based on engine output. */
  private decideShouldContinue(toolCalls: any): boolean {
    return Array.isArray(toolCalls) && toolCalls.length > 0;
  }

  /**
   * Execute a single conversation step with timeout management.
   */
  async runConversationStep(
    context: ConversationContext,
    userReq: UserRequest
  ): Promise<ConversationStepResult> {
    const threadId = context.thread.id;
    const emailId = context.thread.email.id;
    if (!emailId) {
      throw new Error('Thread email missing id');
    }
    const startTime = Date.now();

    // Cancel any existing step for this thread
    this.cancelActiveStep(threadId);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.activeSteps.delete(threadId);
    }, CONVERSATION_STEP_TIMEOUT_MS);

    this.activeSteps.set(threadId, { timeoutId, startTime, emailId, directorId: context.thread.directorId });

    const stepType = context.thread.kind === 'director' ? 'director_llm' : 'agent_llm';
    await this.stepLogger.logStepStart(threadId, stepType, emailId, context.thread.directorId);
    await this.stepLogger.logEngineStart(threadId, stepType, context.thread.messages.length, emailId, context.thread.directorId);

    let engineTimeoutId: NodeJS.Timeout | undefined;

    try {
      const apiCfg = context.apiConfigs.find((c) => c.id === context.thread.apiConfigId);
      if (!apiCfg) {
        throw new Error(`API config not found for thread apiConfigId=${context.thread.apiConfigId}`);
      }
      // Role gate first, then apply per-entity optional allowlist
      const role = context.thread.kind === 'director' ? 'director' : 'agent';
      const gatedToolDescriptors = role === 'director'
        ? resolveDirectorToolDescriptors(this.requireDirector(context))
        : resolveAgentToolDescriptors(this.requireAgentForContext(context));

      const apiConfigPublic: ApiConfigView = serializeApiConfig(apiCfg);
      const engineInput = {
        messages: context.thread.messages,
        apiConfig: apiConfigPublic,
        role,
        toolRegistry: gatedToolDescriptors,
        context: {
          conversationId: context.thread.id,
          agents: context.agents,
        }
      };
      const apiKey = typeof apiCfg.apiKey === 'string' ? apiCfg.apiKey.trim() : '';
      if (!apiKey) {
        throw new ValidationError(`API config ${apiCfg.id} is missing apiKey`, 'API_CONFIG_API_KEY_MISSING');
      }
      const engineInvoke = (input: any) => conversationEngine.run(input, { apiKey });
      const enginePromise = engineInvoke(engineInput as any);
      const engineTimeoutPromise = new Promise<never>((_, reject) => {
        engineTimeoutId = setTimeout(() => {
          void this.stepLogger.logEngineTimeout(threadId, stepType, CONVERSATION_STEP_TIMEOUT_MS, emailId!, context.thread.directorId);
          reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`));
        }, Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
      });
      const result = await Promise.race([enginePromise, engineTimeoutPromise]) as any;
      if (engineTimeoutId) {
        clearTimeout(engineTimeoutId);
        engineTimeoutId = undefined;
      }

      // Log provider request/response
      if (result.request) {
        await this.providerLogger.logRequest(threadId, result.request);
      }
      if (result.response) {
        await this.providerLogger.logResponse(threadId, Date.now() - startTime, result.response, result.response?.usage);
      }

      // Update thread with new messages
      const newMessages = result.assistantMessage ? [result.assistantMessage] : [];
      const updatedThread = newMessages.length > 0
        ? await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, newMessages)
        : context.thread;

      // Process any director tool calls and determine continuation
      const shouldContinue = this.decideShouldContinue(result.toolCalls);
      const toolCallCount = Array.isArray(result.toolCalls) ? result.toolCalls.length : 0;
      if (shouldContinue) {
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = (result.toolCalls as Array<any>).map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        await this.processDirectorToolCalls({ ...context, thread: updatedThread }, userReq, toolCalls);
      }

      const finalThread = (await repoGetThreadById(userReq.repos, userReq.context, threadId)) || updatedThread;
      
      await this.stepLogger.logStepComplete(threadId, stepType, Date.now() - startTime, shouldContinue, toolCallCount, emailId, context.thread.directorId);

      return {
        updatedThread: finalThread,
        success: true,
        // Continue the loop if the director produced tool calls; the next step must consume tool results
        shouldContinue
      };

    } catch (error: any) {
      const failureDuration = Date.now() - startTime;
      if (engineTimeoutId) {
        clearTimeout(engineTimeoutId);
        engineTimeoutId = undefined;
      }
      const meta: Record<string, unknown> = {
        runId: this.runId,
        accountId: this.accountId,
        conversationId: threadId,
        directorId: context.thread.directorId,
        stepType,
        durationMs: failureDuration,
        emailId,
      };
      if (context.thread.kind === 'agent') {
        meta.agentId = (context.thread as AgentThread).agentId;
      }
      if (userReq.traceId) {
        meta.traceId = userReq.traceId;
      }
      if (error instanceof Error) {
        meta.error = error.message;
        if (error.stack) meta.stack = error.stack;
        meta.errorName = error.name;
      } else {
        meta.error = String(error);
      }
      logger.error('Conversation step failed', meta);
      await this.stepLogger.logStepError(threadId, stepType, Date.now() - startTime, error?.message || String(error), emailId, context.thread.directorId);
      return {
        updatedThread: context.thread,
        success: false,
        shouldContinue: false,
        error: error?.message || String(error)
      };
    } finally {
      clearTimeout(timeoutId);
      this.activeSteps.delete(threadId);
    }
  }

  /**
   * Run the conversation loop for the thread, respecting the provided step limit.
   */
  async runConversationLoop(
    context: ConversationContext,
    userReq: UserRequest,
    maxSteps: number = 8
  ): Promise<ConversationThread> {
    let currentThread = context.thread;
    let stepCount = 0;

    while (stepCount < maxSteps) {
      const stepResult = await this.runConversationStep(
        { ...context, thread: currentThread },
        userReq
      );

      currentThread = stepResult.updatedThread;
      stepCount++;

      if (!stepResult.success) {
        await repoFinalizeThreadStatus(userReq.repos, userReq.context, currentThread.id, 'failed');
        // Propagate the specific error up to the caller to surface actionable failure
        const err = new Error(stepResult.error || 'conversation_step_failed');
        throw err;
      }
      if (!stepResult.shouldContinue) {
        await repoFinalizeThreadStatus(userReq.repos, userReq.context, currentThread.id, 'completed');
        break;
      }
    }

    return currentThread;
  }

  /**
   * Run the agent assistant for an agent thread, mirroring route semantics.
   */
  async runAgentAssistant(
    thread: ConversationThread,
    userReq: UserRequest
  ): Promise<{ assistantMessage: PromptMessage | null; content?: string }> {
    // Resolve API config for this agent thread
    const apiConfigs = (await userReq.repos.getSettings(requireContext(userReq.context))).apiConfigs as ApiConfig[];
    const apiConfig = apiConfigs.find((c) => c.id === thread.apiConfigId);
    if (!apiConfig) {
      throw new Error('API config not found');
    }

    const agentThread = this.requireAgentThread(thread, 'runAgentAssistant');

    // Equal tool exposure for agent, except spawning further agents (disabled)
    // Load agent allowlist and apply role + allowlist gating
    const agents = await userReq.repos.getAgents(userReq.context);
    const agent = this.requireAgentById(agentThread.agentId, agents, `Agent ${agentThread.agentId} not found for thread ${agentThread.id}`);
    const gatedToolDescriptors = resolveAgentToolDescriptors(agent);

    let userContent: string;
    try {
      userContent = extractLastUserContent(agentThread.messages as any);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw new ValidationError(
          `Agent thread ${agentThread.id}: ${error.message}`,
          error.code,
          error.statusCode
        );
      }
      throw error;
    }

    const rawHandleTool = createToolHandler(requireRepos(requireContext(userReq.context)));
    const scopedHandleTool = (name: string, params: any) =>
      rawHandleTool(name, params, name.startsWith('workspace_') ? { workspace: { conversationId: agentThread.id } } : undefined);

    let activeThread: AgentThread = agentThread;
    const persistence: AgentConversationPersistence = {
      appendMessages: async (messages: PromptMessage[]) => {
        const updated = await repoAppendMessages(userReq.repos, userReq.context, activeThread.id, messages as any[]);
        if (!updated) {
          throw new Error(`Agent thread ${activeThread.id} missing during append`);
        }
        const ensured = this.requireAgentThread(updated, 'runAgentAssistant.appendMessages');
        activeThread = ensured;
        return ensured;
      },
      finalize: async (status: 'completed' | 'failed') => {
        await repoFinalizeThreadStatus(userReq.repos, userReq.context, activeThread.id, status);
        const reloaded = await repoGetThreadById(userReq.repos, userReq.context, activeThread.id);
        if (!reloaded) {
          throw new Error(`Agent thread ${activeThread.id} missing after finalize`);
        }
        const ensured = this.requireAgentThread(reloaded, 'runAgentAssistant.finalize');
        activeThread = ensured;
        return ensured;
      },
    };

    const agentResult = await runAgentConversation(
      activeThread,
      userContent,
      persistence,
      serializeApiConfig(apiConfig),
      gatedToolDescriptors,
      scopedHandleTool,
      userReq.traceId,
      { apiKey: apiConfig.apiKey },
      async (ev: ProviderEvent) => {
        const t = (ev as any).type;
        if (t === 'request') {
          await this.providerLogger.logRequest(activeThread.id, (ev as any).payload);
        } else if (t === 'response') {
          await this.providerLogger.logResponse(
            activeThread.id,
            (ev as any).latencyMs,
            (ev as any).payload,
            (ev as any).usage
          );
        } else if (t === 'error') {
          await this.providerLogger.logError(
            activeThread.id,
            String((ev as any).error),
            (ev as any).latencyMs
          );
        } else {
          logger.warn('Unknown provider event type', { type: t, conversationId: activeThread.id });
        }
      }
    );

    if (!agentResult.success) {
      throw new Error(agentResult.error || 'Agent conversation failed');
    }

    const lastAssistant = agentResult.finalAssistantMessage as PromptMessage | undefined;
    const contentMaybe = (typeof lastAssistant?.content === 'string') ? lastAssistant.content : undefined;
    return {
      assistantMessage: lastAssistant || null,
      ...(typeof contentMaybe !== 'undefined' ? { content: contentMaybe } : {}),
    };
  }

  /**
   * Process Director tool calls (workspace operations).
   */
  private async processDirectorToolCalls(
    context: ConversationContext,
    userReq: UserRequest,
    toolCalls: Array<{ id: string; name: string; arguments: string }>
  ): Promise<ConversationThread> {
    if (!toolCalls || toolCalls.length === 0) return context.thread;

    const unhandled: Array<{ id: string; name: string }> = [];
    for (const toolCall of toolCalls) {
      const ok = await this.processIndividualToolCall(context, userReq, toolCall);
      if (!ok) unhandled.push({ id: toolCall.id, name: toolCall.name });
    }

    // Contract guard: ensure every tool_call gets a tool reply.
    if (unhandled.length > 0) {
      const msgs = unhandled.map((tc) => ({
        role: 'tool',
        name: tc.name,
        tool_call_id: tc.id,
        content: JSON.stringify({ error: 'unsupported_tool_call', detail: `No handler for ${tc.name}` })
      }));
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, msgs as any);
      try {
        const emailIdStrict = context.thread.email.id; // invariant
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          `contract_violation_unhandled_tools: ${unhandled.map(u => u.name).join(',')}`,
          emailIdStrict,
          context.thread.directorId
        );
      } catch (e: any) {
        logger.warn('Contract guard logging failed', {
          error: e?.message || String(e),
          conversationId: context.thread.id,
          unhandled: unhandled.map(u => u.name)
        });
      }
    }

    return (
      (await repoGetThreadById(userReq.repos, userReq.context, context.thread.id)) ||
      context.thread
    );
  }

  private requireDirector(context: ConversationContext): Director {
    if (!context.director) {
      throw new ValidationError('Director configuration missing for conversation context', 'DIRECTOR_CONFIG_MISSING');
    }
    return context.director;
  }

  private requireAgentThread(thread: ConversationThread, context: string): AgentThread {
    if (thread.kind !== 'agent') {
      throw new InvalidAgentConfigError(
        `${context} requires agent thread; received ${thread.kind}`,
        'AGENT_THREAD_KIND_MISMATCH'
      );
    }
    return thread;
  }

  private requireAgentForContext(context: ConversationContext): Agent {
    if (context.thread.kind !== 'agent') {
      throw new InvalidAgentConfigError('Agent tool resolution requested for non-agent thread', 'AGENT_CONTEXT_MISMATCH');
    }
    const agentId = context.thread.agentId;
    if (context.agent && context.agent.id === agentId) {
      return context.agent;
    }
    return this.requireAgentById(agentId, context.agents, `Agent ${agentId} not found for thread ${context.thread.id}`);
  }

  private requireAgentById(agentId: string, agents: Agent[], message: string): Agent {
    const match = agents.find((candidate) => candidate.id === agentId);
    if (!match) {
      throw new InvalidAgentConfigError(message, 'AGENT_NOT_FOUND');
    }
    return match;
  }

  private async processIndividualToolCall(
    context: ConversationContext,
    userReq: UserRequest,
    toolCall: { id: string; name: string; arguments: string }
  ): Promise<boolean> {
    try {
      const args = JSON.parse(toolCall.arguments);
      
      if (toolCall.name === 'workspace_add_item') {
        return await this.handleWorkspaceAddItem(context, userReq, toolCall, args);
      } else if (toolCall.name === 'workspace_list_items') {
        await this.handleWorkspaceListItems(context, userReq, toolCall, args);
        return true;
      } else {
        // Fallback: route remaining names through generic tool handler to honor contract
        const handleTool = createToolHandler(requireRepos(requireContext(userReq.context)) as any);
        try {
          // Server-supplied invariants: always include conversationId and directorId
          const enriched = {
            ...args,
            conversationId: context.thread.id,
            directorId: context.thread.directorId,
          };
          const exec = await handleTool(
            toolCall.name,
            enriched,
            toolCall.name.startsWith('workspace_') ? { workspace: { conversationId: context.thread.id } } : undefined
          );
          const toolMsg = {
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify(exec)
          } as any;
          await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolMsg]);
          return true;
        } catch (e: any) {
          const toolErrorMsg = {
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: 'tool handler failed', detail: String(e?.message || e) })
          } as any;
          await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
          return true;
        }
      }
    } catch (error: any) {
      logger.error('Error processing director tool call', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: error?.message || String(error)
      });
    }
    return false;
  }

  private async handleWorkspaceAddItem(
    context: ConversationContext,
    userReq: UserRequest,
    toolCall: { id: string; name: string; arguments: string },
    args: any
  ): Promise<boolean> {
    const agentId = args.agent_id;
    if (!agentId) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'missing_agent_id' })
      };
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
      try {
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          'workspace_add_item_missing_agent_id',
          context.thread.email.id,
          context.thread.directorId
        );
      } catch (e) {
        logger.debug('stepLogger.logStepError failed (missing_agent_id)', { err: String(e) });
      }
      return true;
    }

    const agent = await this.validateAgent(agentId, userReq);
    if (!agent) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'agent_not_found', agent_id: String(agentId) })
      };
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
      try {
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          'workspace_add_item_agent_not_found',
          context.thread.email.id,
          context.thread.directorId
        );
      } catch (e) {
        logger.debug('stepLogger.logStepError failed (agent_not_found)', { err: String(e) });
      }
      return true;
    }

    // Resolve director configuration for ensureAgentThread
    const director = context.director || null;
    if (!director) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'director_context_missing' })
      };
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
      try {
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          'workspace_add_item_director_context_missing',
          context.thread.email.id,
          context.thread.directorId
        );
      } catch (e) {
        logger.debug('stepLogger.logStepError failed (director_context_missing)', { err: String(e) });
      }
      return true;
    }

    const conversationSnapshot = await userReq.repos.getConversations(userReq.context);
    const nowIso = new Date().toISOString();
    let agentThread: ConversationThread;
    try {
      const ensure = ensureAgentThread(
        conversationSnapshot,
        context.thread.id,
        director,
        agent,
        context.thread.email as any,
        context.prompts as any,
        context.apiConfigs as any,
        nowIso,
        () => newId(),
        this.accountId,
        userReq.traceId,
        userReq.context
      );

      if (ensure.isNew) {
        agentThread = await userReq.repos.appendConversation(userReq.context, ensure.agentThread);
      } else {
        const persisted = await userReq.repos.getConversationById(userReq.context, ensure.agentThread.id);
        agentThread = persisted ?? ensure.agentThread;
      }
    } catch (e: any) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'ensure_agent_thread_failed', detail: String(e?.message || e) })
      };
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
      try {
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          'workspace_add_item_ensure_agent_failed',
          context.thread.email.id,
          context.thread.directorId
        );
      } catch (e) {
        logger.debug('stepLogger.logStepError failed (ensure_agent_failed)', { err: String(e) });
      }
      return true;
    }

    // Persist workspace item via helper (validates schema and writes to repo)
    let addedItem: WorkspaceItem | null;
    try {
      addedItem = await this.createWorkspaceItem(context, args, agentId, agentThread.id, userReq, { id: toolCall.id, name: toolCall.name });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        const toolErrorMsg = {
          role: 'tool',
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: false, error: 'invalid_workspace_payload', detail: error.message })
        };
        await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg as any]);
        try {
          await this.stepLogger.logStepError(
            context.thread.id,
            'director_tool',
            0,
            'workspace_add_item_invalid_payload',
            context.thread.email.id,
            context.thread.directorId
          );
        } catch (e) {
          logger.debug('stepLogger.logStepError failed (workspace_add_item_invalid_payload)', { err: String(e) });
        }
        return true;
      }
      throw error;
    }
    if (!addedItem) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'workspace_add_failed' })
      };
      await repoAppendMessages(userReq.repos, userReq.context, context.thread.id, [toolErrorMsg]);
      try {
        await this.stepLogger.logStepError(
          context.thread.id,
          'director_tool',
          0,
          'workspace_add_item_failed',
          context.thread.email.id,
          context.thread.directorId
        );
      } catch (e) {
        logger.debug('stepLogger.logStepError failed (workspace_add_failed)', { err: String(e) });
      }
      return true;
    }

    // Inject tool response back into director thread for continuity
    const toolResponse: PromptMessage = {
      id: newId(),
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ added: true, itemId: addedItem.id, label: addedItem.metadata.label }),
    };
    await repoAppendMessage(userReq.repos, userReq.context, context.thread.id, toolResponse);

    // Run the agent conversation after item creation
    await this.executeAgentConversation(context.thread, agentThread, args, toolCall, userReq);
    return true;
  }

  private async handleWorkspaceListItems(
    context: ConversationContext,
    userReq: UserRequest,
    toolCall: { id: string; name: string; arguments: string },
    args: any
  ): Promise<void> {
    const handleTool = createToolHandler(requireRepos(requireContext(userReq.context)) as any);
    const listResult = await handleTool('workspace_list_items', {}, { workspace: { conversationId: context.thread.id } });
    if (!listResult.success) {
      await this.injectAgentErrorMessage(context.thread, toolCall.id, listResult.error || 'Failed to list workspace items', userReq);
      return;
    }

    let items: WorkspaceItem[] = Array.isArray(listResult.result) ? (listResult.result as WorkspaceItem[]) : [];
    const agentId = args.agent_id ? String(args.agent_id) : undefined;
    if (agentId) {
      items = items.filter((it) => String((it as any).provenance?.creatorId) === agentId);
    }

    const toolResponse: PromptMessage = {
      id: newId(),
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ success: true, result: items })
    };

    await repoAppendMessage(userReq.repos, userReq.context, context.thread.id, toolResponse);

    logger.info('Listed workspace items', {
      toolCallId: toolCall.id,
      totalItems: Array.isArray(listResult.result) ? (listResult.result as any[]).length : 0,
      filteredItems: items.length,
      agentFilter: agentId,
    });
  }

  private async validateAgent(agentId: string, userReq: UserRequest): Promise<Agent | null> {
    const agents = await userReq.repos.getAgents(userReq.context);
    const match = agents.find((a: Agent) => a.id === agentId) || null;
    if (!match) {
      return null;
    }
    resolveAgentToolDescriptors(match);
    return match;
  }

  // Removed local ensure/create agent thread logic; using ensureAgentThread() from services/orchestration.ts

  private async createWorkspaceItem(
    context: ConversationContext,
    args: any,
    agentId: string,
    conversationId: string,
    userReq: UserRequest,
    toolCall?: { id: string; name: string }
  ): Promise<WorkspaceItem | null> {
    const handleTool = createToolHandler(requireRepos(requireContext(userReq.context)) as any);
    const mimeType = typeof args.mimeType === 'string' ? args.mimeType : undefined;
    if (!mimeType) {
      throw new ValidationError('workspace_add_item: mimeType is required');
    }
    const encoding = typeof args.encoding === 'string' ? args.encoding : undefined;
    if (!encoding) {
      throw new ValidationError('workspace_add_item: encoding is required');
    }
    const data = typeof args.data === 'string' ? args.data : undefined;
    if (typeof data === 'undefined') {
      throw new ValidationError('workspace_add_item: data is required');
    }

    const payload: any = {
      label: typeof args.label === 'string' ? args.label : (typeof args.title === 'string' ? args.title : 'Untitled'),
      description: typeof args.description === 'string' ? args.description : undefined,
      mimeType,
      encoding,
      data,
      // Do not coerce non-array tags; pass through for schema validation to reject
      ...(typeof args.tags !== 'undefined' ? { tags: Array.isArray(args.tags) ? args.tags : (args as any).tags } : {}),
      provenance: {
        emailId: context.thread.email.id,
        conversationId,
        createdBy: 'director' as const,
        creatorId: context.thread.directorId,
        toolName: toolCall?.name || 'workspace_add_item'
      },
    };

    const addResult = await handleTool('workspace_add_item', payload, { workspace: { conversationId } });
    if (!addResult.success) {
      logger.warn('Workspace add failed', { error: addResult.error });
      return null;
    }
    const resultPayload = addResult.result;
    if (!resultPayload || typeof resultPayload !== 'object') {
      throw new ValidationError('workspace_add_item returned empty result payload', 'WORKSPACE_ADD_EMPTY_RESULT');
    }
    const addedItem = (resultPayload as any).item;
    if (!addedItem || typeof addedItem !== 'object') {
      throw new ValidationError('workspace_add_item missing item in result payload', 'WORKSPACE_ADD_MISSING_ITEM');
    }
    if (typeof addedItem.id !== 'string' || addedItem.id.trim().length === 0) {
      throw new ValidationError('workspace_add_item returned invalid item id', 'WORKSPACE_ADD_INVALID_ITEM');
    }
    logger.info('Added workspace item', { itemId: addedItem.id, agentId, label: addedItem?.metadata?.label });
    return addedItem as WorkspaceItem;
  }

  private async executeAgentConversation(
    parentThread: ConversationThread,
    agentThread: ConversationThread,
    args: any,
    toolCall: { id: string; name: string; arguments: string },
    userReq: UserRequest
  ): Promise<void> {
    try {
      const apiConfigs = (await userReq.repos.getSettings(requireContext(userReq.context))).apiConfigs as ApiConfig[];
      const apiConfig = apiConfigs.find((c) => c.id === parentThread.apiConfigId);
      if (!apiConfig) {
        logger.warn('API config not found for agent conversation', { apiConfigId: parentThread.apiConfigId });
        return;
      }

      const verifiedAgentThread = this.requireAgentThread(agentThread, 'executeAgentConversation');

      // Equal tool exposure for agent, except spawning further agents (disabled)
      const agents = await userReq.repos.getAgents(userReq.context);
      const srcAgent = this.requireAgentById(verifiedAgentThread.agentId, agents, `Agent ${verifiedAgentThread.agentId} not found for agent conversation`);
      const gatedToolDescriptors = resolveAgentToolDescriptors(srcAgent);

      const rawHandleTool = createToolHandler(requireRepos(requireContext(userReq.context)));
      const scopedHandleTool = (name: string, params: any) =>
        rawHandleTool(name, params, name.startsWith('workspace_') ? { workspace: { conversationId: verifiedAgentThread.id } } : undefined);

      if (typeof apiConfig.apiKey !== 'string' || !apiConfig.apiKey.trim()) {
        throw new ValidationError('apiConfig.apiKey missing for agent conversation');
      }

      let delegatedThread: AgentThread = verifiedAgentThread;
      const delegatedPersistence: AgentConversationPersistence = {
        appendMessages: async (messages: PromptMessage[]) => {
          const updated = await repoAppendMessages(userReq.repos, userReq.context, delegatedThread.id, messages as any[]);
          if (!updated) {
            throw new Error(`Agent thread ${delegatedThread.id} missing during delegated append`);
          }
          const ensured = this.requireAgentThread(updated, 'executeAgentConversation.appendMessages');
          delegatedThread = ensured;
          return ensured;
        },
        finalize: async (status: 'completed' | 'failed') => {
          await repoFinalizeThreadStatus(userReq.repos, userReq.context, delegatedThread.id, status);
          const reloaded = await repoGetThreadById(userReq.repos, userReq.context, delegatedThread.id);
          if (!reloaded) {
            throw new Error(`Agent thread ${delegatedThread.id} missing after delegated finalize`);
          }
          const ensured = this.requireAgentThread(reloaded, 'executeAgentConversation.finalize');
          delegatedThread = ensured;
          return ensured;
        },
      };

      const agentResult = await runAgentConversation(
        delegatedThread,
        args.content || args.title || 'New task assigned',
        delegatedPersistence,
        serializeApiConfig(apiConfig),
        gatedToolDescriptors,
        scopedHandleTool,
        userReq.traceId,
        { apiKey: apiConfig.apiKey },
        async (ev: ProviderEvent) => {
          try {
            const t = (ev as any).type;
            if (t === 'request') {
              await this.providerLogger.logRequest(delegatedThread.id, (ev as any).payload);
            } else if (t === 'response') {
              await this.providerLogger.logResponse(
                delegatedThread.id,
                (ev as any).latencyMs,
                (ev as any).payload,
                (ev as any).usage
              );
            } else if (t === 'error') {
              await this.providerLogger.logError(
                delegatedThread.id,
                String((ev as any).error),
                (ev as any).latencyMs
              );
            } else {
              logger.warn('Unknown provider event type', { type: t, conversationId: delegatedThread.id });
            }
          } catch (e: any) {
            logger.warn('Provider event logging failed', {
              error: e?.message || String(e),
              conversationId: delegatedThread.id,
            });
          }
        }
      );

      if (agentResult.success) {
        logger.info('Agent conversation completed successfully', {
          agentId: delegatedThread.agentId,
          conversationId: delegatedThread.id,
          messageLength: agentResult.finalAssistantMessage?.content?.length || 0
        });
      } else {
        await this.injectAgentErrorMessage(parentThread, toolCall.id, agentResult.error, userReq);
      }
    } catch (error: any) {
      logger.error('Error running agent conversation', { 
        agentId: agentThread.agentId, 
        conversationId: agentThread.id,
        error: error?.message || String(error) 
      });
    }
  }

  private async injectAgentErrorMessage(
    thread: ConversationThread,
    toolCallId: string,
    error: string | undefined,
    userReq: UserRequest
  ): Promise<void> {
    logger.warn('Agent conversation failed', { 
      conversationId: thread.id,
      error 
    });
    
    const errorMessage: PromptMessage = {
      id: newId(),
      role: 'tool',
      tool_call_id: toolCallId,
      content: `Agent conversation failed: ${error || 'Unknown error'}`
    };
    
    await repoAppendMessage(userReq.repos, userReq.context, thread.id, errorMessage);
  }

  // thread mutation helpers centralized in services/conversation-mutations.ts

  /** Cancel an active step for the given thread id, if present. */
  cancelActiveStep(threadId: string): boolean {
    const activeStep = this.activeSteps.get(threadId);
    if (activeStep) {
      clearTimeout(activeStep.timeoutId);
      this.activeSteps.delete(threadId);
      
      void this.stepLogger.logStepCancelled(threadId, Date.now() - activeStep.startTime, activeStep.emailId, activeStep.directorId);
      
      return true;
    }
    return false;
  }

  /** Return a snapshot of all active steps with durations. */
  getActiveSteps(): Array<{ threadId: string; startTime: number; durationMs: number }> {
    const now = Date.now();
    return Array.from(this.activeSteps.entries()).map(([threadId, step]) => ({
      threadId,
      startTime: step.startTime,
      durationMs: now - step.startTime
    }));
  }

  /** Cancel all active steps and return the count of cancelled steps. */
  cancelAllActiveSteps(): number {
    const count = this.activeSteps.size;
    for (const [threadId, step] of this.activeSteps.entries()) {
      clearTimeout(step.timeoutId);
      void this.stepLogger.logStepCancelledShutdown(threadId, Date.now() - step.startTime, step.emailId, step.directorId);
    }
    this.activeSteps.clear();
    return count;
  }
}
