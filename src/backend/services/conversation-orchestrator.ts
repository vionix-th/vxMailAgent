import { ConversationThread, PromptMessage, ProviderEvent, Director, Agent, WorkspaceItem } from '../../shared/types';
import { runAgentConversation, ensureAgentThread } from './orchestration-agent';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { createToolHandler } from '../toolCalls';
import { requireReq, requireRepos } from '../utils/repo-access';
import logger from './logger';
import { CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { ConversationStepLogger, ProviderEventLogger } from './logging-handlers';
import type { ReqLike } from '../interfaces';
import type { LiveRepos } from '../liveRepos';
import type { UserRequest as MiddlewareUserRequest } from '../middleware/user-context';
import { conversationEngine } from './engine';
import { newId } from '../utils/id';

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

export interface OrchestrationResult {
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
  private activeSteps = new Map<string, { timeoutId: NodeJS.Timeout; startTime: number; emailId: string }>();
  private stepLogger: ConversationStepLogger;
  private providerLogger: ProviderEventLogger;

  constructor(
    req?: ReqLike
  ) {
    this.stepLogger = new ConversationStepLogger(req);
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
  ): Promise<OrchestrationResult> {
    const threadId = context.thread.id;
    const emailId = context.thread.email?.id;
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

    this.activeSteps.set(threadId, { timeoutId, startTime, emailId });

    try {
      const result = await conversationEngine.run({
        messages: context.thread.messages as any,
        apiConfig: context.apiConfigs.find((c: any) => c.id === context.thread.apiConfigId) as any,
        role: context.thread.kind === 'director' ? 'director' : 'agent',
        roleCaps: context.thread.kind === 'director' ? { canSpawnAgents: true } : { canSpawnAgents: false },
        toolRegistry: TOOL_DESCRIPTORS,
        context: {
          conversationId: context.thread.id,
          agents: context.agents
        }
      });

      // Log provider response
      if (result.response) {
        this.providerLogger.logResponse(threadId, Date.now() - startTime, result.response, result.response?.usage);
      }

      // Update thread with new messages
      const newMessages = result.assistantMessage ? [result.assistantMessage] : [];
      const updatedThread = await this.updateThreadMessages(context.thread, newMessages, userReq);

      // Process any director tool calls and determine continuation
      const shouldContinue = this.decideShouldContinue(result.toolCalls);
      if (shouldContinue) {
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = (result.toolCalls as Array<any>).map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        await this.processDirectorToolCalls({ ...context, thread: updatedThread }, userReq, toolCalls);
      }

      const finalThread = await this.getUpdatedThread(threadId, userReq.repos, userReq.reqLike);
      
      return {
        updatedThread: finalThread,
        success: true,
        // Continue the loop if the director produced tool calls; the next step must consume tool results
        shouldContinue
      };

    } catch (error: any) {
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
        await this.finalizeThreadStatus(currentThread.id, 'failed', userReq);
        break;
      }
      if (!stepResult.shouldContinue) {
        await this.finalizeThreadStatus(currentThread.id, 'completed', userReq);
        break;
      }
    }

    return currentThread;
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

    for (const toolCall of toolCalls) {
      await this.processIndividualToolCall(context, userReq, toolCall);
    }

    return await this.getUpdatedThread(context.thread.id, userReq.repos, userReq.reqLike);
  }

  private async processIndividualToolCall(
    context: ConversationContext,
    userReq: UserRequest,
    toolCall: { id: string; name: string; arguments: string }
  ): Promise<void> {
    try {
      const args = JSON.parse(toolCall.arguments);
      
      if (toolCall.name === 'workspace_add_item') {
        await this.handleWorkspaceAddItem(context, userReq, toolCall, args);
      } else if (toolCall.name === 'workspace_list_items') {
        await this.handleWorkspaceListItems(context, userReq, toolCall, args);
      }
    } catch (error: any) {
      logger.error('Error processing director tool call', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: error?.message || String(error)
      });
    }
  }

  private async handleWorkspaceAddItem(
    context: ConversationContext,
    userReq: UserRequest,
    toolCall: { id: string; name: string; arguments: string },
    args: any
  ): Promise<void> {
    const agentId = args.agent_id;
    if (!agentId) {
      logger.warn('workspace_add_item missing agent_id', { toolCallId: toolCall.id });
      return;
    }

    const agent = await this.validateAgent(agentId, userReq);
    if (!agent) {
      logger.warn('Agent not found for workspace_add_item', { agentId, toolCallId: toolCall.id });
      return;
    }

    // Resolve director configuration for ensureAgentThread
    const director = context.director || null;
    if (!director) {
      logger.warn('Director not available in context for workspace_add_item', { toolCallId: toolCall.id });
      return;
    }

    // Fetch current conversations snapshot
    let conversations = await userReq.repos.getConversations(userReq.reqLike);
    const nowIso = new Date().toISOString();
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
      userReq.traceId,
      userReq.reqLike
    );
    if ('error' in ensure) {
      await this.injectAgentErrorMessage(context.thread, toolCall.id, ensure.error, userReq);
      return;
    }
    conversations = ensure.conversations;
    const agentThread = ensure.agentThread;
    await userReq.repos.setConversations(userReq.reqLike, conversations);

    // Persist workspace item via helper (validates schema and writes to repo)
    const addedItem = await this.createWorkspaceItem(context, args, agentId, agentThread.id, userReq, { id: toolCall.id, name: toolCall.name });
    if (!addedItem) {
      await this.injectAgentErrorMessage(context.thread, toolCall.id, 'Failed to add workspace item', userReq);
      return;
    }

    // Inject tool response back into director thread for continuity
    const toolResponse: PromptMessage = {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ added: true, itemId: addedItem.id, label: addedItem.label }),
    };
    await this.appendMessageToThread(context.thread, toolResponse, userReq);

    // Run the agent conversation after item creation
    await this.executeAgentConversation(context.thread, agentThread, args, toolCall, userReq);
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
      items = items.filter((it) => String((it as any).context?.agentId || (it as any).agentId) === agentId);
    }

    const toolResponse: PromptMessage = {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ items }),
    };

    await this.appendMessageToThread(context.thread, toolResponse, userReq);

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
    const payload: any = {
      label: typeof args.label === 'string' ? args.label : (typeof args.title === 'string' ? args.title : 'Untitled'),
      description: typeof args.description === 'string' ? args.description : undefined,
      mimeType: typeof args.mimeType === 'string' ? args.mimeType : (typeof args.content === 'string' && !args.mimeType ? 'text/plain' : args.mimeType),
      encoding: typeof args.encoding === 'string' ? args.encoding : 'utf8',
      data: typeof args.data === 'string' ? args.data : (typeof args.content === 'string' ? args.content : undefined),
      tags: Array.isArray(args.tags) ? args.tags : (args.type ? [String(args.type)] : undefined),
      context: {
        email: {
          id: String(context.thread.email?.id || ''),
          subject: context.thread.email?.subject,
          from: context.thread.email?.from,
          date: context.thread.email?.date,
        },
        director: { id: context.director?.id || context.thread.directorId, name: context.director?.name },
        agent: { id: agentId, name: context.agents.find(a => a.id === agentId)?.name },
        createdBy: 'director',
        agentId,
        tool: toolCall?.name || 'workspace_add_item',
        conversationId,
      },
    };

    const addResult = await handleTool('workspace_add_item', payload);
    if (!addResult.success) {
      logger.warn('Workspace add failed', { error: addResult.error });
      return null;
    }
    const added: { item?: WorkspaceItem } = (addResult.result || {}) as any;
    logger.info('Added workspace item', { itemId: added?.item?.id, agentId, label: added?.item?.label });
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

      const agentResult = await runAgentConversation(
        agentThread,
        args.content || args.title || 'New task assigned',
        await userReq.repos.getConversations(userReq.reqLike),
        apiConfig,
        TOOL_DESCRIPTORS,
        async (next: ConversationThread[]) => { await userReq.repos.setConversations(userReq.reqLike, next); },
        createToolHandler(requireRepos(requireReq(userReq.reqLike))),
        userReq.traceId,
        async (ev: ProviderEvent) => { 
          logger.info('Provider event', { event: ev, threadId: agentThread.id });
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
      role: 'tool',
      tool_call_id: toolCallId,
      content: `Agent conversation failed: ${error || 'Unknown error'}`
    };
    
    await this.appendMessageToThread(thread, errorMessage, userReq);
  }

  private async appendMessageToThread(
    thread: ConversationThread,
    message: PromptMessage,
    userReq: UserRequest
  ): Promise<void> {
    const updatedThread = {
      ...thread,
      messages: [...thread.messages, message],
      lastActiveAt: new Date().toISOString()
    };
    
    const conversations = await userReq.repos.getConversations(userReq.reqLike);
    const threadIndex = conversations.findIndex((c: ConversationThread) => c.id === thread.id);
    if (threadIndex !== -1) {
      const next = conversations.slice();
      next[threadIndex] = updatedThread;
      await userReq.repos.setConversations(userReq.reqLike, next);
    }
  }

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

    const conversations = await userReq.repos.getConversations(userReq.reqLike);
    const threadIndex = conversations.findIndex((c: ConversationThread) => c.id === thread.id);
    
    if (threadIndex !== -1) {
      const updatedConversations = [
        ...conversations.slice(0, threadIndex),
        updatedThread,
        ...conversations.slice(threadIndex + 1)
      ];
      
      await userReq.repos.setConversations(userReq.reqLike, updatedConversations);
    }

    return updatedThread;
  }

  /** Finalize a thread with a terminal status and endedAt timestamp. */
  private async finalizeThreadStatus(
    threadId: string,
    status: 'completed' | 'failed',
    userReq: UserRequest
  ): Promise<void> {
    const conversations = await userReq.repos.getConversations(userReq.reqLike);
    const idx = conversations.findIndex((c: ConversationThread) => c.id === threadId);
    if (idx === -1) return;
    const now = new Date().toISOString();
    const updated = { ...conversations[idx], status, endedAt: now, lastActiveAt: now } as ConversationThread;
    const next = conversations.slice();
    next[idx] = updated;
    await userReq.repos.setConversations(userReq.reqLike, next);
  }

  private async getUpdatedThread(
    threadId: string,
    repos: LiveRepos,
    reqLike: ReqLike
  ): Promise<ConversationThread> {
    const conversations = await repos.getConversations(reqLike);
    const updatedThread = conversations.find((c: ConversationThread) => c.id === threadId);
    return updatedThread || conversations.find((c: ConversationThread) => c.id === threadId)!;
  }

  /** Cancel an active step for the given thread id, if present. */
  cancelActiveStep(threadId: string): boolean {
    const activeStep = this.activeSteps.get(threadId);
    if (activeStep) {
      clearTimeout(activeStep.timeoutId);
      this.activeSteps.delete(threadId);
      
      this.stepLogger.logStepCancelled(threadId, Date.now() - activeStep.startTime, activeStep.emailId);
      
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
      this.stepLogger.logStepCancelledShutdown(threadId, Date.now() - step.startTime, step.emailId);
    }
    this.activeSteps.clear();
    return count;
  }
}
