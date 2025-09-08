import { ConversationThread, Agent, Director, WorkspaceItem } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { conversationEngine } from './engine';
import { beginSpan, endSpan } from './logging';
import { newId } from '../utils/id';
import { CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { logConversationStepDiagnostic } from './orchestration';
import { ConversationStepLogger, ProviderEventLogger } from './logging-handlers';
import type { ReqLike } from '../interfaces';
import { ensureAgentThread, appendMessageToThread, runAgentConversation } from './orchestration';
import { repoGetAll, repoSetAll } from '../utils/repo-access';
import logger from './logger';

export interface ConversationContext {
  thread: ConversationThread;
  director?: Director;
  agent?: Agent;
  agents: Agent[];
  apiConfigs: any[];
  prompts: any[];
  traceId: string;
}

export interface OrchestrationResult {
  updatedThread: ConversationThread;
  success: boolean;
  shouldContinue: boolean;
  error?: string;
}

/**
 * Handles conversation orchestration for both director and agent threads.
 * Separated from fetcher service for better testability and maintainability.
 */
/**
 * Orchestrates Director and Agent thread execution: drives steps, processes Director tool calls,
 * spawns Agent threads, and persists transcripts and provider diagnostics.
 */
export class ConversationOrchestrator {
  private activeSteps = new Map<string, { timeoutId: NodeJS.Timeout; startTime: number }>();
  private stepLogger: ConversationStepLogger;
  private providerLogger: ProviderEventLogger;

  constructor(
    private repos: LiveRepos,
    private logOrch: (entry: any) => void,
    private req?: ReqLike
  ) {
    this.stepLogger = new ConversationStepLogger(this.req);
    this.providerLogger = new ProviderEventLogger(this.req);
  }

  /** Persist a terminal status for a conversation thread. */
  private async finalizeThreadStatus(
    threadId: string,
    status: 'completed' | 'failed',
    userReq: UserRequest
  ): Promise<ConversationThread | null> {
    try {
      const conversations = await this.repos.getConversations(userReq);
      const idx = conversations.findIndex(c => c.id === threadId);
      if (idx === -1) return null;
      const endedAt = new Date().toISOString();
      const updated = {
        ...conversations[idx],
        status,
        endedAt,
        lastActiveAt: endedAt,
      } as ConversationThread;
      const next = [
        ...conversations.slice(0, idx),
        updated,
        ...conversations.slice(idx + 1),
      ];
      await this.repos.setConversations(userReq, next);
      return updated;
    } catch {
      return null;
    }
  }

  /**
   * Run a single step for the current thread with timeout/error handling.
   * Returns the updated thread and a continuation flag.
   */
  async runConversationStep(
    context: ConversationContext,
    userReq: UserRequest
  ): Promise<OrchestrationResult> {
    const { thread } = context;
    const stepStartTime = Date.now();
    
    this.stepLogger.logStepStart(thread.id, thread.kind);
    
    try {
      const stepResult = await this.executeConversationStep(context, userReq);
      
      if (!stepResult.success) {
        // Ensure error paths that return (not throw) still produce a step error log
        const stepDuration = Date.now() - stepStartTime;
        this.stepLogger.logStepError(
          thread.id,
          thread.kind,
          stepDuration,
          stepResult.error || 'unknown_error'
        );
        return {
          updatedThread: thread,
          success: false,
          shouldContinue: false,
          error: stepResult.error
        };
      }

      let updatedThread = await this.updateThreadMessages(
        thread,
        stepResult.messages,
        userReq
      );

      let shouldContinue = !!(stepResult.toolCalls && stepResult.toolCalls.length > 0);
      if (shouldContinue && thread.kind === 'director') {
        updatedThread = await this.processDirectorToolCalls(
          { ...context, thread: updatedThread },
          userReq,
          stepResult.toolCalls as any
        );
        shouldContinue = true;
      }
      // If there are no tool calls and we've appended assistant message, finalize thread
      if (!shouldContinue) {
        const finalized = await this.finalizeThreadStatus(updatedThread.id, 'completed', userReq);
        if (finalized) updatedThread = finalized;
      }
      const stepDuration = Date.now() - stepStartTime;

      this.stepLogger.logStepComplete(
        thread.id,
        thread.kind,
        stepDuration,
        shouldContinue,
        stepResult.toolCalls?.length || 0
      );

      return {
        updatedThread,
        success: true,
        shouldContinue
      };

    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      
      this.stepLogger.logStepError(thread.id, thread.kind, stepDuration, error.message);

      // On error, finalize thread as failed
      let failedThread: ConversationThread = thread;
      try {
        const finalized = await this.finalizeThreadStatus(thread.id, 'failed', userReq);
        if (finalized) failedThread = finalized;
      } catch (e: any) {
        logger.warn('ORCHESTRATOR failed to finalize thread as failed', {
          error: e?.message || String(e),
          threadId: thread.id,
          kind: thread.kind,
        });
      }

      return {
        updatedThread: failedThread,
        success: false,
        shouldContinue: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a single provider call for the given thread and return assistant message + tool calls.
   */
  private async executeConversationStep(
    context: ConversationContext,
    userReq: UserRequest
  ): Promise<{
    success: boolean;
    messages: any[];
    toolCalls?: any[];
    error?: string;
  }> {
    const { thread, traceId, apiConfigs } = context;
    
    const apiConfig = apiConfigs.find(c => c.id === thread.apiConfigId);
    if (!apiConfig) {
      return {
        success: false,
        messages: [],
        error: 'API configuration not found'
      };
    }

    const role = thread.kind === 'director' ? 'director' : 'agent';
    const roleCaps = thread.kind === 'director' ? { canSpawnAgents: true } : {};

    // Compute effective tool registry: mandatory + enabled optionals per role
    const baseDescriptors = TOOL_DESCRIPTORS;
    let enabledNames: string[] = [];
    if (role === 'agent') {
      const ag = (context.agents || []).find(a => a.id === thread.agentId);
      enabledNames = ag?.enabledToolCalls || [];
    } else {
      enabledNames = context.director?.enabledToolCalls || [];
    }
    const filteredDescriptors = baseDescriptors.filter(d => d.flags?.mandatory || enabledNames.includes(d.name));
    // Dynamic agent__<id> tools for directors, restricted to assigned agents when available
    let dynamicAgentTools: any[] = [];
    if (role === 'director') {
      const allowedAgentIds = context.director?.agentIds && Array.isArray(context.director.agentIds) && context.director.agentIds.length
        ? new Set(context.director.agentIds)
        : null;
      dynamicAgentTools = (context.agents || [])
        .filter(a => !allowedAgentIds || allowedAgentIds.has(a.id))
        .map(a => ({
          name: `agent__${a.id}`,
          description: `Run agent ${a.name || a.id} with input text` as const,
          inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
          flags: { mandatory: true },
        }));
    }
    const toolRegistry = role === 'director' ? [...filteredDescriptors, ...dynamicAgentTools] : filteredDescriptors;

    logConversationStepDiagnostic(
      `${role}_llm` as any,
      thread.id,
      { 
        [role + 'Id']: thread.kind === 'director' ? thread.directorId : thread.agentId,
        emailId: thread.email?.id 
      },
      this.logOrch
    );

    const t0 = Date.now();
    const sLlm = beginSpan(traceId, {
      type: 'llm_call',
      name: `${role}_chatCompletion`,
      [`${role}Id`]: thread.kind === 'director' ? thread.directorId : thread.agentId,
      emailId: thread.email?.id
    }, userReq);

    try {
      this.stepLogger.logEngineStart(thread.id, thread.kind, thread.messages.length);

      const stepPromise = conversationEngine.run({
        messages: thread.messages as any,
        apiConfig: apiConfig as any,
        role: role as any,
        roleCaps: { canSpawnAgents: roleCaps?.canSpawnAgents ?? false },
        toolRegistry,
        context: { 
          conversationId: thread.id, 
          traceId, 
          agents: context.agents 
        },
      });

      const stepTimeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          this.stepLogger.logEngineTimeout(thread.id, thread.kind, CONVERSATION_STEP_TIMEOUT_MS);
          // Clean up active step tracking
          this.activeSteps.delete(thread.id);
          reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`));
        }, Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
        
        // Track active step for cleanup
        this.activeSteps.set(thread.id, {
          timeoutId,
          startTime: Date.now()
        });
      });

      const engineOut = await Promise.race([stepPromise, stepTimeoutPromise]) as any;
      const latencyMs = Date.now() - t0;

      const activeStep = this.activeSteps.get(thread.id);
      if (activeStep) {
        clearTimeout(activeStep.timeoutId);
        this.activeSteps.delete(thread.id);
      }

      endSpan(traceId, sLlm, { status: 'ok', response: { latencyMs } }, userReq);

      this.logProviderEvents(thread.id, engineOut, latencyMs);

      return {
        success: true,
        messages: [engineOut.assistantMessage],
        toolCalls: engineOut.toolCalls
      };

    } catch (error: any) {
      const latencyMs = Date.now() - t0;
      
      const activeStep = this.activeSteps.get(thread.id);
      if (activeStep) {
        clearTimeout(activeStep.timeoutId);
        this.activeSteps.delete(thread.id);
      }
      
      endSpan(traceId, sLlm, { status: 'error', error: error.message }, userReq);

      this.providerLogger.logError(thread.id, error.message, latencyMs);

      return {
        success: false,
        messages: [],
        error: error.message
      };
    }
  }

  /**
   * Append new messages to the thread and persist the conversations list.
   */
  private async updateThreadMessages(
    thread: ConversationThread,
    newMessages: any[],
    userReq: UserRequest
  ): Promise<ConversationThread> {
    const updatedThread = {
      ...thread,
      messages: [...thread.messages, ...newMessages],
      lastActiveAt: new Date().toISOString()
    };

    const conversations = await this.repos.getConversations(userReq);
    const threadIndex = conversations.findIndex(c => c.id === thread.id);
    
    if (threadIndex !== -1) {
      const updatedConversations = [
        ...conversations.slice(0, threadIndex),
        updatedThread,
        ...conversations.slice(threadIndex + 1)
      ];
      
      await this.repos.setConversations(userReq, updatedConversations);
    }

    return updatedThread;
  }

  /** Log provider request/response events for diagnostics. */
  private logProviderEvents(conversationId: string, engineOut: any, latencyMs: number): void {
    try {
      // Use ProviderEventLogger to ensure user request context is applied
      if (engineOut.request) {
        this.providerLogger.logRequest(conversationId, engineOut.request);
      }

      const usage = engineOut.response?.usage;
      this.providerLogger.logResponse(conversationId, latencyMs, engineOut.response, usage);
    } catch (error) {
      // Swallow logging errors to prevent disrupting main flow
    }
  }

  /**
   * Process Director tool calls (e.g., agent__<id>), ensuring Agent threads and running Agent loops.
   * Returns the updated Director thread after injecting tool results.
   */
  private async processDirectorToolCalls(
    context: ConversationContext,
    userReq: UserRequest,
    toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined
  ): Promise<ConversationThread> {
    if (!toolCalls || toolCalls.length === 0) return context.thread;

    const { thread, agents, apiConfigs, prompts, traceId } = context;

    let conversations = await this.repos.getConversations(userReq);

    // For each agent__ tool call, ensure agent thread and run the agent conversation
    for (const tc of toolCalls) {
      if (!tc?.name) continue;
      if (!tc.name.startsWith('agent__')) continue;

      const agentId = tc.name.slice('agent__'.length);
      const agent = agents.find(a => a.id === agentId);
      if (!agent) {
        // Inject tool error into director thread
        const toolErrorMsg = {
          role: 'tool',
          name: tc.name,
          tool_call_id: tc.id,
          content: JSON.stringify({ error: 'unknown_agent', details: { agentId } })
        };
        conversations = appendMessageToThread(conversations, thread.id, toolErrorMsg);
        await this.repos.setConversations(userReq, conversations);
        continue;
      }

      const nowIso = new Date().toISOString();
      const ensured = ensureAgentThread(
        conversations,
        thread.id,
        { id: thread.directorId, name: undefined, promptId: thread.promptId, apiConfigId: thread.apiConfigId } as any,
        agent,
        thread.email,
        prompts as any,
        apiConfigs as any,
        nowIso,
        () => newId(),
        traceId,
        this.req
      );

      if ('error' in ensured) {
        const toolErrorMsg = {
          role: 'tool',
          name: tc.name,
          tool_call_id: tc.id,
          content: JSON.stringify({ error: ensured.error, reason: ensured.reason })
        };
        conversations = appendMessageToThread(conversations, thread.id, toolErrorMsg);
        await this.repos.setConversations(userReq, conversations);
        // Strict failure escalation: abort processing and propagate error
        throw new Error(`agent_thread_ensure_failed:${ensured.error}:${ensured.reason}`);
      }

      conversations = ensured.conversations;
      const agentThread = ensured.agentThread;

      await this.repos.setConversations(userReq, conversations);

      let agentInput = '';
      try {
        const parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
        agentInput = String(parsed.input || '').trim();
      } catch (e: any) {
        logger.warn('ORCHESTRATOR failed to parse tool arguments', {
          error: e?.message || String(e),
          tool: tc?.name,
          raw: String(tc?.arguments || ''),
        });
      }

      const handleTool = async (name: string, params: any): Promise<any> => {
        switch (name) {
          case 'workspace_add_item': {
            // Force director-scoped workspace: use parent director thread id
            const targetId = thread.id;
            const convs = await this.repos.getConversations(userReq);
            const t = convs.find(c => c.id === targetId);
            if (!t) return { ok: false, error: 'conversation_not_found', conversationId: targetId };

            const item: WorkspaceItem = {
              id: newId(),
              label: params?.label,
              description: params?.description,
              mimeType: params?.mimeType,
              encoding: params?.encoding,
              data: params?.data,
              tags: Array.isArray(params?.tags) ? params.tags : undefined,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              context: params?.context || {
                email: { id: t.email.id, subject: t.email.subject, from: t.email.from, date: t.email.date },
                director: { id: thread.directorId },
                agent: { id: agentThread.agentId },
                createdBy: 'agent',
                agentId: agentThread.agentId,
                tool: 'workspace_add_item',
                conversationId: targetId,
              },
            };
            const items = await repoGetAll<WorkspaceItem>(this.req as any, 'workspaceItems');
            await repoSetAll<WorkspaceItem>(this.req as any, 'workspaceItems', [...items, item]);
            return { ok: true, item };
          }
          case 'workspace_list_items': {
            const targetId = thread.id;
            const items = await repoGetAll<WorkspaceItem>(this.req as any, 'workspaceItems');
            const filtered = items.filter(i => !i.deleted && i.context?.conversationId === targetId);
            return { ok: true, items: filtered };
          }
          default:
            return { ok: false, error: 'unsupported_tool', name };
        }
      };

      const setConversations = async (next: ConversationThread[]) => {
        await this.repos.setConversations(userReq, next);
      };

      const logProvider = (ev: any) => {
        try {
          if (!ev || !ev.type) return;
          if (ev.type === 'request') this.providerLogger.logRequest(ev.conversationId, ev.payload);
          else if (ev.type === 'response') this.providerLogger.logResponse(ev.conversationId, ev.latencyMs || 0, ev.payload, ev.usage);
          else if (ev.type === 'error') this.providerLogger.logError(ev.conversationId, ev.error || 'unknown_error', ev.latencyMs);
        } catch (e: any) {
          logger.warn('ORCHESTRATOR provider logger failed', {
            error: e?.message || String(e),
            conversationId: ev?.conversationId,
            type: ev?.type,
          });
        }
      };

      const agentApi = apiConfigs.find(c => c.id === agent.apiConfigId) as any;
      const result = await runAgentConversation(
        agentThread,
        agentInput,
        conversations,
        agentApi,
        TOOL_DESCRIPTORS as any,
        setConversations,
        handleTool,
        traceId,
        logProvider
      );

      const dirToolMsg = {
        role: 'tool',
        name: tc.name,
        tool_call_id: tc.id,
        content: JSON.stringify({ status: result.success ? 'completed' : 'failed', agentThreadId: agentThread.id, lastAssistant: result.finalAssistantMessage?.content ?? null })
      };
      conversations = appendMessageToThread(conversations, thread.id, dirToolMsg);
      await this.repos.setConversations(userReq, conversations);
    }

    const updated = (await this.repos.getConversations(userReq)).find(c => c.id === context.thread.id) as ConversationThread;
    return updated || context.thread;
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

      if (!stepResult.success || !stepResult.shouldContinue) {
        break;
      }
    }

    return currentThread;
  }

  /** Cancel an active step for the given thread id, if present. */
  cancelActiveStep(threadId: string): boolean {
    const activeStep = this.activeSteps.get(threadId);
    if (activeStep) {
      clearTimeout(activeStep.timeoutId);
      this.activeSteps.delete(threadId);
      
      this.stepLogger.logStepCancelled(threadId, Date.now() - activeStep.startTime);
      
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
      this.stepLogger.logStepCancelledShutdown(threadId, Date.now() - step.startTime);
    }
    this.activeSteps.clear();
    return count;
  }
}
