import { ConversationThread, Agent, Director, Prompt } from '../../shared/types';
import { beginSpan, endSpan } from './logging';
import logger from './logger';
import { CONVERSATION_STEP_TIMEOUT_MS, TOOL_EXEC_TIMEOUT_MS } from '../config';
import { conversationEngine } from './engine';
import { newId } from '../utils/id';
import type { ReqLike } from '../interfaces';
import { InvalidAgentConfigError } from './error-handler';
import { appendMessageToThread, finalizeThreadStatus } from './conversation-mutations';

export interface AgentConversationResult {
  finalMessages: any[];
  finalAssistantMessage: any;
  conversations: ConversationThread[];
  success: boolean;
  error?: string;
}

/**
 * Ensure an agent thread exists under a director thread, creating or reusing one.
 * Returns { conversations, agentThread, isNew }.
 * Throws an Error when configuration is invalid (e.g., missing agent api/prompt).
 */
export function ensureAgentThread(
  conversations: ConversationThread[],
  dirThreadId: string,
  director: Director,
  agent: Agent,
  emailEnvelope: any,
  prompts: Prompt[],
  apiConfigs: any[],
  nowIso: string,
  newIdFn: () => string,
  traceId?: string,
  req?: ReqLike,
): { conversations: ConversationThread[]; agentThread: ConversationThread; isNew: boolean } {
  const spanId = traceId ? beginSpan(traceId, { type: 'conversation_update', name: 'ensureAgentThread', directorId: director.id, agentId: agent.id, emailId: (emailEnvelope as any)?.id }, req) : '';

  let agentThread = undefined as ConversationThread | undefined;
  if (!agentThread) {
    const reusable = conversations.find(c =>
      c.kind === 'agent' &&
      c.parentId === dirThreadId &&
      c.agentId === agent.id &&
      c.status === 'ongoing'
    );
    if (reusable) {
      agentThread = reusable;
      if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: false, agentThreadId: agentThread.id, reused: true } }, req);
      return { conversations, agentThread, isNew: false } as const;
    }
  }
  const agentPrompt = prompts.find(p => p.id === agent.promptId);
  const agentApi = apiConfigs.find((c: any) => c.id === agent.apiConfigId);
  if (!agentApi || !agentPrompt) {
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'error', error: 'missing agent api/prompt' }, req);
    // Throw to avoid returning a union type and to simplify call sites.
    throw new InvalidAgentConfigError('missing agent api/prompt');
  }

  const isNew = !agentThread;
  if (!agentThread) {
    const agentThreadId = newIdFn();
    const nowIso2 = nowIso;
    agentThread = { id: agentThreadId, kind: 'agent', parentId: dirThreadId, directorId: director.id, agentId: agent.id, traceId, email: emailEnvelope as any, promptId: agentPrompt.id, apiConfigId: agentApi.id, startedAt: nowIso2, status: 'ongoing', endedAt: null, lastActiveAt: nowIso2, messages: [...agentPrompt.messages], errors: [] } as ConversationThread;
    conversations = [...conversations, agentThread];
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: true, agentThreadId } }, req);
    return { conversations, agentThread, isNew };
  }

  if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: false, agentThreadId: agentThread.id } }, req);
  return { conversations, agentThread, isNew } as const;
}

/**
 * Appends a message to the specified conversation thread.
 */
// moved to services/conversation-mutations.ts

/**
 * Run the Agent conversation loop, handling tool calls and optional provider logging.
 * Returns the final assistant message, updated conversations snapshot, and success status.
 */
export async function runAgentConversation(
  agentThread: ConversationThread,
  initialUserMessage: string,
  conversations: ConversationThread[],
  apiConfig: any,
  toolRegistry: any[],
  setConversations: (next: ConversationThread[]) => void,
  handleTool: (name: string, params: any) => Promise<any>,
  traceId?: string,
  logProviderEvent?: (event: any) => void,
): Promise<AgentConversationResult> {
  const LOOP_MAX = 6;
  let stepCount = 0;
  let currentMessages: any[] = [...agentThread.messages];
  let updatedConversations = [...conversations];
  let lastAssistant: any = null;
  if (initialUserMessage) {
    const userMsg = { role: 'user', content: initialUserMessage, context: { traceId } };
    currentMessages.push(userMsg);
    updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, userMsg);
    setConversations(updatedConversations);
  }

  try {
    while (stepCount < LOOP_MAX) {
      stepCount++;

      const t0 = Date.now();
      let stepTimeoutId: any;
      const stepPromise = conversationEngine.run({
        messages: currentMessages,
        apiConfig,
        role: 'agent',
        roleCaps: { canSpawnAgents: false },
        toolRegistry,
        context: { conversationId: agentThread.id, traceId },
      });
      const stepTimeoutPromise = new Promise<never>((_, reject) => {
        stepTimeoutId = setTimeout(() => reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`)), Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
      });
      const result = await Promise.race([stepPromise, stepTimeoutPromise]) as any;
      clearTimeout(stepTimeoutId);

      const latencyMs = Date.now() - t0;
      const now = new Date().toISOString();

      if (logProviderEvent) {
        try {
          if (result.request) {
            logProviderEvent({
              id: newId(),
              conversationId: agentThread.id,
              provider: 'openai',
              type: 'request',
              timestamp: now,
              payload: result.request,
            });
          }
          const usage = (result.response && (result.response as any).usage) || undefined;
          logProviderEvent({
            id: newId(),
            conversationId: agentThread.id,
            provider: 'openai',
            type: 'response',
            timestamp: now,
            latencyMs,
            usage: usage ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            } : undefined,
            payload: result.response,
          });
        } catch (e: any) {
          logger.warn('ORCHESTRATION provider event logging failed', {
            error: e?.message || String(e),
            conversationId: agentThread.id,
          });
        }
      }

      const assistant = result.assistantMessage;
      lastAssistant = assistant;
      currentMessages.push(assistant);
      updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, assistant);
      setConversations(updatedConversations);
      if (!result.toolCalls || result.toolCalls.length === 0) {
        // No more tool calls -> finalize agent thread as completed
        updatedConversations = finalizeThreadStatus(updatedConversations, agentThread.id, 'completed');
        setConversations(updatedConversations);
        break;
      }
      for (const tc of result.toolCalls) {
        let args: any = {};
        try {
          args = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch (e: any) {
          const toolErrorMsg = {
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'invalid tool arguments', details: String(e?.message || e) })
          };
          currentMessages.push(toolErrorMsg);
          updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, toolErrorMsg);
          setConversations(updatedConversations);
          continue;
        }

        try {
          // Find director and agent info for context enrichment
          const director = conversations.find(c => c.id === agentThread.parentId);
          const directorInfo = director ? { id: director.directorId, name: undefined } : { id: agentThread.directorId, name: undefined };
          
          const argsWithContext = { 
            ...args, 
            conversationId: agentThread.id,
            // Pass context for workspace item creation
            context: {
              email: {
                id: agentThread.email.id,
                subject: agentThread.email.subject,
                from: agentThread.email.from,
                date: agentThread.email.date
              },
              director: directorInfo,
              agent: {
                id: agentThread.agentId,
                name: undefined // Agent name not readily available in this scope
              },
              createdBy: 'agent' as const,
              agentId: agentThread.agentId,
              conversationId: agentThread.id
            }
          };
          let toolTimeoutId: any;
          const execPromise = handleTool(tc.name, argsWithContext);
          const toolTimeoutPromise = new Promise<never>((_, reject) => {
            toolTimeoutId = setTimeout(() => reject(new Error(`tool_exec_timeout_${TOOL_EXEC_TIMEOUT_MS}ms`)), Math.max(1, TOOL_EXEC_TIMEOUT_MS || 0));
          });
          const exec = await Promise.race([execPromise, toolTimeoutPromise]);
          clearTimeout(toolTimeoutId);
          const toolMsg = {
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id, 
            content: JSON.stringify(exec) 
          };
          
          currentMessages.push(toolMsg);
          updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, toolMsg);
          setConversations(updatedConversations);
        } catch (e: any) {
          const toolErrorMsg = {
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'tool execution failed', details: String(e?.message || e) })
          };
          currentMessages.push(toolErrorMsg);
          updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, toolErrorMsg);
          setConversations(updatedConversations);
        }
      }
    }

    return {
      finalMessages: currentMessages,
      finalAssistantMessage: lastAssistant,
      conversations: updatedConversations,
      success: true,
    };
  } catch (e: any) {
    // On error, mark agent thread as failed
    try {
      updatedConversations = finalizeThreadStatus(updatedConversations, agentThread.id, 'failed');
      setConversations(updatedConversations);
    } catch (e2: any) {
      logger.warn('ORCHESTRATION failed to persist agent failed status', {
        error: e2?.message || String(e2),
        conversationId: agentThread.id,
      });
    }
    if (logProviderEvent) {
      try {
        const now = new Date().toISOString();
        logProviderEvent({
          id: newId(),
          conversationId: agentThread.id,
          provider: 'openai',
          type: 'error',
          timestamp: now,
          error: String(e?.message || e),
        });
      } catch (e3: any) {
        logger.warn('ORCHESTRATION provider error-event logging failed', {
          error: e3?.message || String(e3),
          conversationId: agentThread.id,
        });
      }
    }
    return {
      finalMessages: currentMessages,
      finalAssistantMessage: lastAssistant,
      conversations: updatedConversations,
      success: false,
      error: String(e?.message || e),
    };
  }
}
