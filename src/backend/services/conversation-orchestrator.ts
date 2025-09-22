import { ConversationThread, PromptMessage, ProviderEvent, Director, Agent, WorkspaceItem, ApiConfigPublic } from '../../shared/types';
import { runAgentConversation, ensureAgentThread } from './orchestration-agent';
// Tool descriptors are filtered via filterToolDescriptorsByRole
import { selectToolDescriptors } from '../utils/tools';
import { createToolHandler } from '../toolCalls';
import { requireReq, requireRepos } from '../utils/repo-access';
import logger from './logger';
import { CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { ConversationStepLogger, ProviderEventLogger } from './logging';
import type { ReqLike } from '../interfaces';
import type { LiveRepos } from '../liveRepos';
import type { UserRequest as MiddlewareUserRequest } from '../middleware/user-context';
import { conversationEngine } from './engine';
import { newId } from '../utils/id';
import { repoAppendMessage, repoAppendMessages, repoFinalizeThreadStatus, repoGetThreadById } from './conversation-mutations';
import { extractLastUserContent } from '../utils/message-transformers';
import { ValidationError } from './error-handler';

export interface ConversationContext {
  thread: ConversationThread;
  director?: Director;
  agent?: Agent;
  agents: Agent[];
  apiConfigs: any[];
  prompts: any[];
  traceId: string;
}

export interface UserRequest {
  repos: LiveRepos;
  reqLike: ReqLike;
  traceId?: string;
}

export function createUserRequest(middlewareReq: MiddlewareUserRequest, repos: LiveRepos): UserRequest {
  return {
    repos,
    reqLike: middlewareReq as ReqLike,
    traceId: middlewareReq.headers?.['x-trace-id'] as string
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

  constructor(req: ReqLike | undefined, runId: string, accountId: string) {
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

    try {
      const apiCfg = context.apiConfigs.find((c: any) => c.id === context.thread.apiConfigId);
      if (!apiCfg) {
        throw new Error(`API config not found for thread apiConfigId=${context.thread.apiConfigId}`);
      }
      let engineTimeoutId: any;
      // Role gate first, then apply per-entity optional allowlist
      const role = context.thread.kind === 'director' ? 'director' : 'agent';
      const directorEnabled = context.director?.enabledToolCalls || [];
      const gatedToolDescriptors = role === 'director'
        ? selectToolDescriptors('director', directorEnabled)
        : selectToolDescriptors('agent');

      const apiConfigPublic: ApiConfigPublic = { id: apiCfg.id, name: apiCfg.name, model: apiCfg.model, ...(typeof apiCfg.maxCompletionTokens === 'number' ? { maxCompletionTokens: apiCfg.maxCompletionTokens } : {}) };
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
      const engineInvoke = (input: any) => conversationEngine.run(input, { apiKey: apiCfg.apiKey });
      const enginePromise = engineInvoke(engineInput as any);
      const engineTimeoutPromise = new Promise<never>((_, reject) => {
        engineTimeoutId = setTimeout(() => {
          void this.stepLogger.logEngineTimeout(threadId, stepType, CONVERSATION_STEP_TIMEOUT_MS, emailId!, context.thread.directorId);
          reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`));
        }, Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
      });
      const result = await Promise.race([enginePromise, engineTimeoutPromise]) as any;
      clearTimeout(engineTimeoutId);

      // Log provider request/response
      if (result.request) {
        await this.providerLogger.logRequest(threadId, result.request);
      }
      if (result.response) {
        await this.providerLogger.logResponse(threadId, Date.now() - startTime, result.response, result.response?.usage);
      }

      // Update thread with new messages
      const newMessages = result.assistantMessage ? [result.assistantMessage] : [];
      const updatedThread = (await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, newMessages)) || context.thread;

      // Process any director tool calls and determine continuation
      const shouldContinue = this.decideShouldContinue(result.toolCalls);
      const toolCallCount = Array.isArray(result.toolCalls) ? result.toolCalls.length : 0;
      if (shouldContinue) {
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = (result.toolCalls as Array<any>).map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        await this.processDirectorToolCalls({ ...context, thread: updatedThread }, userReq, toolCalls);
      }

      const finalThread = (await repoGetThreadById(userReq.repos, userReq.reqLike, threadId)) || updatedThread;
      
      await this.stepLogger.logStepComplete(threadId, stepType, Date.now() - startTime, shouldContinue, toolCallCount, emailId, context.thread.directorId);

      return {
        updatedThread: finalThread,
        success: true,
        // Continue the loop if the director produced tool calls; the next step must consume tool results
        shouldContinue
      };

    } catch (error: any) {
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
        await repoFinalizeThreadStatus(userReq.repos, userReq.reqLike, currentThread.id, 'failed');
        // Propagate the specific error up to the caller to surface actionable failure
        const err = new Error(stepResult.error || 'conversation_step_failed');
        throw err;
      }
      if (!stepResult.shouldContinue) {
        await repoFinalizeThreadStatus(userReq.repos, userReq.reqLike, currentThread.id, 'completed');
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
    const apiConfigs = (await userReq.repos.getSettings(requireReq(userReq.reqLike))).apiConfigs;
    const apiConfig = apiConfigs.find((c: any) => c.id === thread.apiConfigId);
    if (!apiConfig) {
      throw new Error('API config not found');
    }

    // Equal tool exposure for agent, except spawning further agents (disabled)
    // Load agent allowlist and apply role + allowlist gating
    const agents = await userReq.repos.getAgents(userReq.reqLike);
    const agent = agents.find((a: any) => a.id === thread.agentId);
    const gatedToolDescriptors = selectToolDescriptors('agent', agent?.enabledToolCalls || []);

    const userContent = extractLastUserContent(thread.messages as any);

    const agentResult = await runAgentConversation(
      thread,
      userContent,
      await userReq.repos.getConversations(userReq.reqLike),
      { id: apiConfig.id, name: apiConfig.name, model: apiConfig.model, ...(typeof apiConfig.maxCompletionTokens === 'number' ? { maxCompletionTokens: apiConfig.maxCompletionTokens } : {}) } as ApiConfigPublic,
      gatedToolDescriptors,
      async (next: ConversationThread[]) => { await userReq.repos.setConversations(userReq.reqLike, next); },
      createToolHandler(requireRepos(requireReq(userReq.reqLike))),
      userReq.traceId,
      { apiKey: apiConfig.apiKey },
      async (ev: ProviderEvent) => {
        const t = (ev as any).type;
        if (t === 'request') {
          await this.providerLogger.logRequest(thread.id, (ev as any).payload);
        } else if (t === 'response') {
          await this.providerLogger.logResponse(
            thread.id,
            (ev as any).latencyMs,
            (ev as any).payload,
            (ev as any).usage
          );
        } else if (t === 'error') {
          await this.providerLogger.logError(
            thread.id,
            String((ev as any).error),
            (ev as any).latencyMs
          );
        } else {
          logger.warn('Unknown provider event type', { type: t, conversationId: thread.id });
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
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, msgs as any);
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
      (await repoGetThreadById(userReq.repos, userReq.reqLike, context.thread.id)) ||
      context.thread
    );
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
        const handleTool = createToolHandler(requireRepos(requireReq(userReq.reqLike)) as any);
        try {
          // Server-supplied invariants: always include conversationId and directorId
          const enriched = {
            ...args,
            conversationId: context.thread.id,
            directorId: context.thread.directorId,
          };
          const exec = await handleTool(toolCall.name, enriched);
          const toolMsg = {
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify(exec)
          } as any;
          await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolMsg]);
          return true;
        } catch (e: any) {
          const toolErrorMsg = {
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: 'tool handler failed', detail: String(e?.message || e) })
          } as any;
          await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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

    // Fetch current conversations snapshot
    let conversations = await userReq.repos.getConversations(userReq.reqLike);
    const nowIso = new Date().toISOString();
    let agentThread: ConversationThread;
    try {
      const ensure = ensureAgentThread(
        conversations,
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
        userReq.reqLike
      );
      conversations = ensure.conversations;
      agentThread = ensure.agentThread;
      await userReq.repos.setConversations(userReq.reqLike, conversations);
    } catch (e: any) {
      const toolErrorMsg = {
        role: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'ensure_agent_thread_failed', detail: String(e?.message || e) })
      };
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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
        await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg as any]);
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
      await repoAppendMessages(userReq.repos, userReq.reqLike, context.thread.id, [toolErrorMsg]);
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
    await repoAppendMessage(userReq.repos, userReq.reqLike, context.thread.id, toolResponse);

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
    const handleTool = createToolHandler(requireRepos(requireReq(userReq.reqLike)) as any);
    const listResult = await handleTool('workspace_list_items', {});
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

    await repoAppendMessage(userReq.repos, userReq.reqLike, context.thread.id, toolResponse);

    logger.info('Listed workspace items', {
      toolCallId: toolCall.id,
      totalItems: Array.isArray(listResult.result) ? (listResult.result as any[]).length : 0,
      filteredItems: items.length,
      agentFilter: agentId,
    });
  }

  private async validateAgent(agentId: string, userReq: UserRequest): Promise<Agent | null> {
    const agents = await userReq.repos.getAgents(userReq.reqLike);
    return agents.find((a: Agent) => a.id === agentId) || null;
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
    const handleTool = createToolHandler(requireRepos(requireReq(userReq.reqLike)) as any);
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

    const addResult = await handleTool('workspace_add_item', payload);
    if (!addResult.success) {
      logger.warn('Workspace add failed', { error: addResult.error });
      return null;
    }
    const added: { item?: WorkspaceItem } = (addResult.result || {}) as any;
    logger.info('Added workspace item', { itemId: added?.item?.id, agentId, label: added?.item?.metadata.label });
    return (added?.item as WorkspaceItem) || null;
  }

  private async executeAgentConversation(
    parentThread: ConversationThread,
    agentThread: ConversationThread,
    args: any,
    toolCall: { id: string; name: string; arguments: string },
    userReq: UserRequest
  ): Promise<void> {
    try {
      const apiConfigs = (await userReq.repos.getSettings(requireReq(userReq.reqLike))).apiConfigs;
      const apiConfig = apiConfigs.find((c: any) => c.id === parentThread.apiConfigId);
      if (!apiConfig) {
        logger.warn('API config not found for agent conversation', { apiConfigId: parentThread.apiConfigId });
        return;
      }

      // Equal tool exposure for agent, except spawning further agents (disabled)
      const agents = await userReq.repos.getAgents(userReq.reqLike);
      const srcAgent = agents.find((a: any) => a.id === agentThread.agentId);
      const gatedToolDescriptors = selectToolDescriptors('agent', srcAgent?.enabledToolCalls || []);

      const agentResult = await runAgentConversation(
        agentThread,
        args.content || args.title || 'New task assigned',
        await userReq.repos.getConversations(userReq.reqLike),
        { id: apiConfig.id, name: apiConfig.name, model: apiConfig.model, ...(typeof apiConfig.maxCompletionTokens === 'number' ? { maxCompletionTokens: apiConfig.maxCompletionTokens } : {}) } as any,
        gatedToolDescriptors,
        async (next: ConversationThread[]) => { await userReq.repos.setConversations(userReq.reqLike, next); },
        createToolHandler(requireRepos(requireReq(userReq.reqLike))),
        userReq.traceId,
        apiConfig.apiKey,
        async (ev: ProviderEvent) => {
          try {
            const t = (ev as any).type;
            if (t === 'request') {
              await this.providerLogger.logRequest(agentThread.id, (ev as any).payload);
            } else if (t === 'response') {
              await this.providerLogger.logResponse(
                agentThread.id,
                (ev as any).latencyMs,
                (ev as any).payload,
                (ev as any).usage
              );
            } else if (t === 'error') {
              await this.providerLogger.logError(
                agentThread.id,
                String((ev as any).error),
                (ev as any).latencyMs
              );
            } else {
              logger.warn('Unknown provider event type', { type: t, conversationId: agentThread.id });
            }
          } catch (e: any) {
            logger.warn('Provider event logging failed', {
              error: e?.message || String(e),
              conversationId: agentThread.id,
            });
          }
        }
      );

      if (agentResult.success) {
        logger.info('Agent conversation completed successfully', { 
          agentId: agentThread.agentId, 
          conversationId: agentThread.id,
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
    
    await repoAppendMessage(userReq.repos, userReq.reqLike, thread.id, errorMessage);
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
