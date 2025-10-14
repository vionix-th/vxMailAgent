import { ConversationThread, Agent, Director, Prompt, ApiConfig, PromptMessage } from '../../shared/types';
import { beginSpan, endSpan } from './logging';
import logger from './logger';
import { CONVERSATION_STEP_TIMEOUT_MS, TOOL_EXEC_TIMEOUT_MS } from '../config';
import { conversationEngine } from './engine';
import { newId } from '../utils/id';
import type { ContextInput } from '../utils/repo-access';
import { InvalidAgentConfigError, ValidationError } from './error-handler';
import { ApiConfigView } from './apiConfigSerializer';

export interface AgentConversationResult {
  finalMessages: any[];
  finalAssistantMessage: any;
  updatedThread: ConversationThread;
  success: boolean;
  error?: string;
}

export interface AgentConversationPersistence {
  appendMessages(messages: PromptMessage[]): Promise<ConversationThread>;
  finalize(status: 'completed' | 'failed'): Promise<ConversationThread>;
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
  apiConfigs: ApiConfig[],
  nowIso: string,
  newIdFn: () => string,
  accountId: string,
  traceId?: string,
  req?: ContextInput,
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
  const agentApi = apiConfigs.find((c) => c.id === agent.apiConfigId);
  if (!agentApi || !agentPrompt) {
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'error', error: 'missing agent api/prompt' }, req);
    // Throw to avoid returning a union type and to simplify call sites.
    throw new InvalidAgentConfigError('missing agent api/prompt');
  }

  const isNew = !agentThread;
  if (!agentThread) {
    const agentThreadId = newIdFn();
    const nowIso2 = nowIso;
    agentThread = { id: agentThreadId, kind: 'agent', parentId: dirThreadId, accountId, directorId: director.id, agentId: agent.id, email: emailEnvelope as any, promptId: agentPrompt.id, apiConfigId: agentApi.id, startedAt: nowIso2, status: 'ongoing', endedAt: null, lastActiveAt: nowIso2, messages: [...agentPrompt.messages], errors: [] } as ConversationThread;
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
  persistence: AgentConversationPersistence,
  apiConfig: ApiConfigView,
  toolRegistry: any[],
  handleTool: (name: string, params: any) => Promise<any>,
  traceId: string | undefined,
  secrets: { apiKey: string },
  logProviderEvent?: (event: any) => void,
): Promise<AgentConversationResult> {
  const LOOP_MAX = 6;
  let stepCount = 0;
  let currentMessages: PromptMessage[] = [...agentThread.messages];
  let currentThread: ConversationThread = agentThread;
  let lastAssistant: PromptMessage | null = null;
  const apiKey = typeof secrets.apiKey === 'string' ? secrets.apiKey.trim() : '';
  if (!apiKey) {
    throw new ValidationError('Agent conversation requires provider apiKey', 'API_CONFIG_API_KEY_MISSING');
  }

  const appendAndPersist = async (message: PromptMessage): Promise<void> => {
    currentMessages.push(message);
    currentThread = await persistence.appendMessages([message]);
  };

  const finalizeThread = async (status: 'completed' | 'failed'): Promise<void> => {
    currentThread = await persistence.finalize(status);
  };

  if (initialUserMessage) {
    const userMsg: PromptMessage = { id: newId(), role: 'user', content: initialUserMessage };
    await appendAndPersist(userMsg);
  }

  try {
    while (stepCount < LOOP_MAX) {
      stepCount++;

      const t0 = Date.now();
      let stepTimeoutId: any;
      const engineInput = {
        messages: currentMessages,
        apiConfig,
        role: 'agent',
        toolRegistry,
        context: { conversationId: currentThread.id, traceId },
      };
      const stepPromise = conversationEngine.run(engineInput as any, { apiKey });
      const stepTimeoutPromise = new Promise<never>((_, reject) => {
        stepTimeoutId = setTimeout(() => reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`)), Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
      });
      const result = await Promise.race([stepPromise, stepTimeoutPromise]) as any;
      clearTimeout(stepTimeoutId);

      const latencyMs = Date.now() - t0;
      const now = new Date().toISOString();

      if (logProviderEvent) {
        if (result.request) {
          await logProviderEvent({
            id: newId(),
            conversationId: currentThread.id,
            provider: 'openai',
            type: 'request',
            timestamp: now,
            payload: result.request,
          });
        }
        const usage = (result.response && (result.response as any).usage) || undefined;
        await logProviderEvent({
          id: newId(),
          conversationId: currentThread.id,
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
      }

      const assistant = result.assistantMessage as PromptMessage | undefined;
      if (assistant) {
        const assistantMsg = typeof assistant.id === 'string' && assistant.id.trim()
          ? assistant
          : { ...assistant, id: newId() };
        lastAssistant = assistantMsg;
        await appendAndPersist(assistantMsg);
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        await finalizeThread('completed');
        break;
      }

      for (const tc of result.toolCalls) {
        let args: any = {};
        try {
          args = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch (e: any) {
          const toolErrorMsg: PromptMessage = {
            id: newId(),
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'invalid tool arguments', details: String(e?.message || e) })
          };
          await appendAndPersist(toolErrorMsg);
          continue;
        }

        try {
          const argsWithContext = {
            ...args,
            conversationId: currentThread.id,
            provenance: {
              emailId: currentThread.email.id,
              conversationId: currentThread.id,
              createdBy: 'agent' as const,
              creatorId: currentThread.agentId,
              toolName: tc.name,
            },
          };
          let toolTimeoutId: any;
          const execPromise = handleTool(tc.name, argsWithContext);
          const toolTimeoutPromise = new Promise<never>((_, reject) => {
            toolTimeoutId = setTimeout(() => reject(new Error(`tool_exec_timeout_${TOOL_EXEC_TIMEOUT_MS}ms`)), Math.max(1, TOOL_EXEC_TIMEOUT_MS || 0));
          });
          const exec = await Promise.race([execPromise, toolTimeoutPromise]);
          clearTimeout(toolTimeoutId);
          const toolMsg: PromptMessage = {
            id: newId(),
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify(exec),
          };
          await appendAndPersist(toolMsg);
        } catch (e: any) {
          const toolErrorMsg: PromptMessage = {
            id: newId(),
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'tool execution failed', details: String(e?.message || e) })
          };
          await appendAndPersist(toolErrorMsg);
        }
      }
    }

    return {
      finalMessages: currentMessages,
      finalAssistantMessage: lastAssistant,
      updatedThread: currentThread,
      success: true,
    };
  } catch (e: any) {
    try {
      await finalizeThread('failed');
    } catch (e2: any) {
      logger.warn('ORCHESTRATION failed to persist agent failed status', {
        error: e2?.message || String(e2),
        conversationId: currentThread.id,
      });
    }
    if (logProviderEvent) {
      const now = new Date().toISOString();
      await logProviderEvent({
        id: newId(),
        conversationId: currentThread.id,
        provider: 'openai',
        type: 'error',
        timestamp: now,
        error: String(e?.message || e),
      });
    }
    return {
      finalMessages: currentMessages,
      finalAssistantMessage: lastAssistant,
      updatedThread: currentThread,
      success: false,
      error: String(e?.message || e),
    };
  }
}
