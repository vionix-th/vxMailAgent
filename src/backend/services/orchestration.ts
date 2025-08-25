import { Agent, Director, Filter, Prompt, ConversationThread } from '../../shared/types';
import { beginSpan, endSpan } from './logging';

export interface EmailContext {
  from: string;
  subject: string;
  bodyPlain?: string;
  bodyHtml?: string;
  snippet?: string;
  date?: string;
}

export interface FilterEvaluation {
  filter: Filter;
  match: boolean;
  fieldValue: string;
}

export function evaluateFilters(filters: Filter[], ctx: EmailContext): FilterEvaluation[] {
  return filters.map(f => {
    let match = false;
    let fieldValue = '';
    try {
      switch (f.field) {
        case 'from': fieldValue = ctx.from || ''; break;
        case 'subject': fieldValue = ctx.subject || ''; break;
        case 'body': fieldValue = (ctx.bodyPlain || '') + '\n' + (ctx.bodyHtml || '') + '\n' + (ctx.snippet || ''); break;
        case 'date': fieldValue = ctx.date || ''; break;
        default: fieldValue = '';
      }
      match = new RegExp(f.regex, 'i').test(fieldValue);
    } catch {}
    return { filter: f, match, fieldValue };
  });
}

export function selectDirectorTriggers(evals: FilterEvaluation[]): string[] {
  const directorTriggers: string[] = [];
  const nonDupSeen = new Set<string>();
  for (const e of evals) {
    if (!e.match) continue;
    const dirId = e.filter.directorId;
    if (e.filter.duplicateAllowed) directorTriggers.push(dirId);
    else if (!nonDupSeen.has(dirId)) { directorTriggers.push(dirId); nonDupSeen.add(dirId); }
  }
  return directorTriggers;
}

// Removed legacy buildDirectorToolSpecs; engine handles tool exposure and dynamic agent tools.

// Finalization policy for director conversations.
// Today we finalize after the tool-call loop; extracted for future configurability.
export function shouldFinalizeDirector(): boolean {
  return true;
}

// --- Agent session helpers ---
export interface AgentSessionDeps {
  isDirectorFinalized: (dirId: string) => boolean;
}

export function ensureAgentThread(
  conversations: ConversationThread[],
  dirThreadId: string,
  director: Director,
  agent: Agent,
  emailEnvelope: any,
  prompts: Prompt[],
  apiConfigs: any[],
  deps: AgentSessionDeps,
  nowIso: string,
  newIdFn: () => string,
  traceId?: string,
): { conversations: ConversationThread[]; agentThread: ConversationThread; isNew: boolean } | { conversations: ConversationThread[]; error: string; reason: 'finalized' | 'invalid' } {
  const spanId = traceId ? beginSpan(traceId, { type: 'conversation_update', name: 'ensureAgentThread', directorId: director.id, agentId: agent.id, emailId: (emailEnvelope as any)?.id }) : '';
  if (deps.isDirectorFinalized(dirThreadId)) {
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'error', error: 'director conversation finalized; no further agent messages accepted' });
    return { conversations, error: 'director conversation finalized; no further agent messages accepted', reason: 'finalized' } as const;
  }

  let agentThread = undefined as ConversationThread | undefined;
  // Backend-enforced session reuse: if no valid requestedSessionId, reuse an existing active agent thread
  if (!agentThread) {
    const reusable = conversations.find(c =>
      c.kind === 'agent' &&
      c.parentId === dirThreadId &&
      c.agentId === agent.id &&
      c.status === 'ongoing' &&
      !c.finalized
    );
    if (reusable) {
      agentThread = reusable;
      if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: false, agentThreadId: agentThread.id, reused: true } });
      return { conversations, agentThread, isNew: false } as const;
    }
  }
  const agentPrompt = prompts.find(p => p.id === agent.promptId);
  const agentApi = apiConfigs.find((c: any) => c.id === agent.apiConfigId);
  if (!agentApi || !agentPrompt) {
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'error', error: 'missing agent api/prompt' });
    return { conversations, error: 'missing agent api/prompt', reason: 'invalid' } as const;
  }

  const isNew = !agentThread;
  if (!agentThread) {
    const agentThreadId = newIdFn();
    const nowIso2 = nowIso;
    agentThread = { id: agentThreadId, kind: 'agent', parentId: dirThreadId, directorId: director.id, agentId: agent.id, traceId, email: emailEnvelope as any, promptId: agentPrompt.id, apiConfigId: agentApi.id, startedAt: nowIso2, status: 'ongoing', lastActiveAt: nowIso2, messages: [...(agentPrompt.messages || [])], errors: [], workspaceItems: [], finalized: false } as ConversationThread;
    conversations = [...conversations, agentThread];
    if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: true, agentThreadId } });
    return { conversations, agentThread, isNew };
  }

  if (traceId && spanId) endSpan(traceId, spanId, { status: 'ok', response: { created: false, agentThreadId: agentThread.id } });
  return { conversations, agentThread, isNew } as const;
}

export function appendMessageToThread(
  conversations: ConversationThread[],
  threadId: string,
  message: any,
): ConversationThread[] {
  const idx = conversations.findIndex(c => c.id === threadId);
  if (idx === -1) return conversations;
  const updated = { ...conversations[idx], lastActiveAt: new Date().toISOString(), messages: [...(conversations[idx].messages || []), message] } as any;
  return [...conversations.slice(0, idx), updated, ...conversations.slice(idx + 1)];
}

export interface AgentConversationResult {
  finalMessages: any[];
  finalAssistantMessage: any;
  conversations: ConversationThread[];
  success: boolean;
  error?: string;
}

export async function runAgentConversation(
  agentThread: ConversationThread,
  initialUserMessage: string,
  conversations: ConversationThread[],
  apiConfig: any,
  toolRegistry: any[],
  setConversations: (next: ConversationThread[]) => void,
  traceId?: string,
  logProviderEvent?: (event: any) => void,
): Promise<AgentConversationResult> {
  const LOOP_MAX = 6;
  let stepCount = 0;
  let currentMessages: any[] = [...(agentThread.messages || [])];
  let updatedConversations = [...conversations];
  let lastAssistant: any = null;

  // Add initial user message if provided
  if (initialUserMessage) {
    const userMsg = { role: 'user', content: initialUserMessage, context: { traceId } };
    currentMessages.push(userMsg);
    updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, userMsg);
    setConversations(updatedConversations);
  }

  try {
    while (stepCount < LOOP_MAX) {
      stepCount++;
      
      // Import conversationEngine and handleToolByName
      const { conversationEngine } = require('./engine');
      const { handleToolByName } = require('../toolCalls');

      const t0 = Date.now();
      // Agent LLM call
      const result = await conversationEngine.run({
        messages: currentMessages,
        apiConfig,
        role: 'agent',
        roleCaps: { canSpawnAgents: false },
        toolRegistry,
        context: { conversationId: agentThread.id, traceId },
      });

      const latencyMs = Date.now() - t0;
      const now = new Date().toISOString();

      // Log provider events if logger provided
      if (logProviderEvent) {
        try {
          if (result.request) {
            logProviderEvent({
              id: require('../utils/id').newId(),
              conversationId: agentThread.id,
              provider: 'openai',
              type: 'request',
              timestamp: now,
              payload: result.request,
            });
          }
          const usage = (result.response && (result.response as any).usage) || undefined;
          logProviderEvent({
            id: require('../utils/id').newId(),
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
        } catch {}
      }

      // Append assistant message
      const assistant = result.assistantMessage;
      lastAssistant = assistant;
      currentMessages.push(assistant);
      updatedConversations = appendMessageToThread(updatedConversations, agentThread.id, assistant);
      setConversations(updatedConversations);

      // If no tool calls, agent is done
      if (!result.toolCalls || result.toolCalls.length === 0) {
        break;
      }

      // Execute tools and append responses
      for (const tc of result.toolCalls) {
        let args: any = {};
        try { 
          args = tc.arguments ? JSON.parse(tc.arguments) : {}; 
        } catch (e: any) {
          // Log tool argument parsing error
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
          // Pass conversationId to workspace tools
          const argsWithContext = { ...args, conversationId: agentThread.id };
          const exec = await handleToolByName(tc.name, argsWithContext);
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
          // Log tool execution error
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
    // Log agent conversation failure if logger provided
    if (logProviderEvent) {
      try {
        const now = new Date().toISOString();
        logProviderEvent({
          id: require('../utils/id').newId(),
          conversationId: agentThread.id,
          provider: 'openai',
          type: 'error',
          timestamp: now,
          error: String(e?.message || e),
        });
      } catch {}
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
