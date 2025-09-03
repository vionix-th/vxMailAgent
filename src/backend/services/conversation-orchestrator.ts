import { ConversationThread, Agent, Director } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { conversationEngine } from './engine';
import { beginSpan, endSpan } from './logging';
import { newId } from '../utils/id';
import { CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { TOOL_REGISTRY } from '../../shared/tools';
import { logConversationStepDiagnostic } from './orchestration';
import { ConversationStepLogger, ProviderEventLogger } from './logging-handlers';
import type { ReqLike } from '../interfaces';

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
export class ConversationOrchestrator {
  private activeSteps = new Map<string, { timeoutId: NodeJS.Timeout; startTime: number }>();
  private stepLogger: ConversationStepLogger;
  private providerLogger: ProviderEventLogger;

  constructor(
    private repos: LiveRepos,
    private logProviderEvent: (event: any) => void,
    private logOrch: (entry: any) => void,
    private req?: ReqLike
  ) {
    this.stepLogger = new ConversationStepLogger(this.req);
    this.providerLogger = new ProviderEventLogger(this.req);
  }

  /**
   * Run a single conversation step with timeout and error handling.
   */
  async runConversationStep(
    context: ConversationContext,
    userReq: UserRequest
  ): Promise<OrchestrationResult> {
    const { thread } = context;
    const stepStartTime = Date.now();
    
    // Log step start
    this.stepLogger.logStepStart(thread.id, thread.kind);
    
    try {
      const stepResult = await this.executeConversationStep(context, userReq);
      
      if (!stepResult.success) {
        return {
          updatedThread: thread,
          success: false,
          shouldContinue: false,
          error: stepResult.error
        };
      }

      // Update thread with new messages
      const updatedThread = await this.updateThreadMessages(
        thread,
        stepResult.messages,
        userReq
      );

      // Process tool calls if any
      const shouldContinue = !!(stepResult.toolCalls && stepResult.toolCalls.length > 0);
      const stepDuration = Date.now() - stepStartTime;

      // Log step completion
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

      return {
        updatedThread: thread,
        success: false,
        shouldContinue: false,
        error: error.message
      };
    }
  }

  /**
   * Execute the actual LLM conversation step.
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
      // Log engine call start
      this.stepLogger.logEngineStart(thread.id, thread.kind, thread.messages.length);

      const stepPromise = conversationEngine.run({
        messages: thread.messages as any,
        apiConfig: apiConfig as any,
        role: role as any,
        roleCaps: { canSpawnAgents: roleCaps?.canSpawnAgents ?? false },
        toolRegistry: TOOL_REGISTRY,
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

      // Clean up active step tracking on successful completion
      const activeStep = this.activeSteps.get(thread.id);
      if (activeStep) {
        clearTimeout(activeStep.timeoutId);
        this.activeSteps.delete(thread.id);
      }

      endSpan(traceId, sLlm, { status: 'ok', response: { latencyMs } }, userReq);

      // Log provider events
      this.logProviderEvents(thread.id, engineOut, latencyMs);

      return {
        success: true,
        messages: [engineOut.assistantMessage],
        toolCalls: engineOut.toolCalls
      };

    } catch (error: any) {
      const latencyMs = Date.now() - t0;
      
      // Clean up active step tracking on error
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
   * Update conversation thread with new messages.
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

  /**
   * Log provider events for request/response tracking.
   */
  private logProviderEvents(conversationId: string, engineOut: any, latencyMs: number): void {
    try {
      const now = new Date().toISOString();
      
      if (engineOut.request) {
        this.logProviderEvent({
          id: newId(),
          conversationId,
          provider: 'openai',
          type: 'request',
          timestamp: now,
          payload: engineOut.request
        });
      }

      const usage = engineOut.response?.usage;
      this.logProviderEvent({
        id: newId(),
        conversationId,
        provider: 'openai',
        type: 'response',
        timestamp: now,
        latencyMs,
        usage: usage ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        } : undefined,
        payload: engineOut.response
      });
    } catch (error) {
      // Swallow logging errors to prevent disrupting main flow
    }
  }

  /**
   * Run complete conversation loop with step limit.
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

  /**
   * Cancel any active conversation step for a thread.
   */
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

  /**
   * Get status of active conversation steps.
   */
  getActiveSteps(): Array<{ threadId: string; startTime: number; durationMs: number }> {
    const now = Date.now();
    return Array.from(this.activeSteps.entries()).map(([threadId, step]) => ({
      threadId,
      startTime: step.startTime,
      durationMs: now - step.startTime
    }));
  }

  /**
   * Cancel all active steps (for cleanup on shutdown).
   */
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
