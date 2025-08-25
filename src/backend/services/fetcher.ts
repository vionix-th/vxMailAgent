import fs from 'fs';
import * as persistence from '../persistence';
import { ACCOUNTS_FILE, FETCHER_LOG_FILE } from '../utils/paths';
import { getMailProvider } from '../providers/mail';
import { newId } from '../utils/id';
import { conversationEngine } from './engine';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { FetcherLogEntry, Account, ConversationThread, OrchestrationDiagnosticEntry, ProviderEvent, Filter, Director, Agent, Prompt } from '../../shared/types';
import { evaluateFilters, selectDirectorTriggers, shouldFinalizeDirector, ensureAgentThread } from './orchestration';
import { beginTrace, endTrace, beginSpan, endSpan } from './logging';

export interface FetcherDeps {
  // state getters/setters
  getSettings: () => any;
  getFilters: () => Filter[];
  getDirectors: () => Director[];
  getAgents: () => Agent[];
  getPrompts: () => Prompt[];
  getConversations: () => ConversationThread[];
  setConversations: (next: ConversationThread[]) => void;

  // diagnostics
  logOrch: (e: OrchestrationDiagnosticEntry) => void;
  logProviderEvent: (e: ProviderEvent) => void;

  // lifecycle helpers
  isDirectorFinalized: (dirId: string) => boolean;
}

export interface FetcherService {
  getStatus: () => { active: boolean; running: boolean; lastRun: string | null; nextRun: string | null; accountStatus: Record<string, { lastRun: string | null; lastError: string | null }> };
  startFetcherLoop: () => void;
  stopFetcherLoop: () => void;
  fetchEmails: () => Promise<void>;
  getFetcherLog: () => FetcherLogEntry[];
  setFetcherLog: (next: FetcherLogEntry[]) => void;
}

/** Initialize the background email fetcher service. */
export function initFetcher(deps: FetcherDeps): FetcherService {
  let fetcherActive = false;
  let fetcherInterval: NodeJS.Timeout | null = null;
  let fetcherLastRun: string | null = null;
  let fetcherNextRun: string | null = null;
  let fetcherRunning = false;
  let fetcherLog: FetcherLogEntry[] = [];
  let fetcherAccountStatus: Record<string, { lastRun: string | null; lastError: string | null }> = {};

  // Initialize in-memory fetcher log from disk so counts/stats reflect persisted state
  try {
    if (fs.existsSync(FETCHER_LOG_FILE)) {
      const loaded = persistence.loadAndDecrypt(FETCHER_LOG_FILE) as FetcherLogEntry[];
      // Backfill IDs for legacy entries
      fetcherLog = (loaded || []).map(e => ({ ...e, id: e.id || newId() }));
      try { persistence.encryptAndPersist(fetcherLog, FETCHER_LOG_FILE); } catch {}
    }
  } catch (e) {
    console.error('[ERROR] Failed to initialize fetcherLog from disk:', e);
  }

  function logFetch(entry: FetcherLogEntry) {
    try {
      const withId: FetcherLogEntry = { ...entry, id: entry.id || newId() };
      fetcherLog.push(withId);
      persistence.encryptAndPersist(fetcherLog, FETCHER_LOG_FILE);
    } catch (e) {
      console.error('[ERROR] Failed to persist fetcherLog entry:', e);
    }
  }

  async function fetchEmails() {
    if (fetcherRunning) {
      logFetch({ timestamp: new Date().toISOString(), level: 'warn', event: 'cycle_skip', message: 'Fetch cycle already running; skipping re-entry' });
      return;
    }
    fetcherRunning = true;
    const fetchStart = new Date().toISOString();
    fetcherLastRun = fetchStart;
    fetcherNextRun = null;
    logFetch({ timestamp: fetchStart, level: 'info', event: 'cycle_start', message: 'Starting fetch cycle' });

    const settings = deps.getSettings();
    const filters = deps.getFilters();
    const directors = deps.getDirectors();
    const agents = deps.getAgents();
    let conversations = deps.getConversations();

    let accounts: Account[] = [];
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE) as Account[];
        logFetch({ timestamp: new Date().toISOString(), level: 'debug', event: 'accounts_loaded', message: `Loaded ${accounts.length} accounts from store`, count: accounts.length });
      } else {
        logFetch({ timestamp: new Date().toISOString(), level: 'warn', event: 'accounts_missing', message: 'No accounts file found at startup' });
      }
    } catch (e) {
      logFetch({ timestamp: new Date().toISOString(), level: 'error', event: 'accounts_load_error', message: 'Error loading accounts', detail: String(e) });
      fetcherRunning = false;
      return;
    }

    for (const account of accounts) {
      // Account-level trace for provider ops in this cycle
      const accountTraceId = beginTrace({ accountId: account.id, provider: account.provider });
      if (!fetcherAccountStatus[account.id]) fetcherAccountStatus[account.id] = { lastRun: null, lastError: null };
      try {
        logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'account_start', message: 'Fetching emails...' });
        if (account.provider === 'gmail' || account.provider === 'outlook') {
          const provider = getMailProvider(account.provider);
          if (!provider) {
            logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'provider_missing', message: `${account.provider} provider not available` });
            continue;
          }
          // Token refresh span
          const sRefresh = beginSpan(accountTraceId, { type: 'token_refresh', name: 'ensureValidAccessToken', provider: account.provider });
          const refreshResult = await provider.ensureValidAccessToken(account);
          endSpan(accountTraceId, sRefresh, { status: (refreshResult as any)?.error ? 'error' : 'ok', error: (refreshResult as any)?.error });
          if ((refreshResult as any)?.error) {
            const errMsg = (refreshResult as any).error;
            fetcherAccountStatus[account.id].lastError = errMsg;
            logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'oauth_refresh_error', message: 'Failed to refresh access token', detail: errMsg });
            continue;
          }
          if (refreshResult.updated) {
            account.tokens.accessToken = refreshResult.accessToken;
            account.tokens.expiry = refreshResult.expiry;
            account.tokens.refreshToken = refreshResult.refreshToken;
            const accountsAll = persistence.loadAndDecrypt(ACCOUNTS_FILE);
            const idx = accountsAll.findIndex((a: any) => a.id === account.id);
            if (idx !== -1) {
              accountsAll[idx].tokens = { ...account.tokens };
              persistence.encryptAndPersist(accountsAll, ACCOUNTS_FILE);
              logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'oauth_refreshed', message: 'Refreshed and persisted new access token' });
            }
          }
          // Messages list span
          const sList = beginSpan(accountTraceId, { type: 'provider_fetch', name: 'fetchUnread', provider: account.provider });
          const envelopes = await provider.fetchUnread(account, { max: 10, unreadOnly: true });
          endSpan(accountTraceId, sList, { status: 'ok', response: { count: envelopes.length } });
          logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'messages_listed', message: 'Listed unread messages', count: envelopes.length });

          for (const env of envelopes) {
            // Per-email trace
            const traceId = beginTrace({ emailId: env.id, accountId: account.id, provider: account.provider });
            const msgId = env.id;
            const subject = String(env.subject || '');
            const from = String(env.from || '');
            const date = String(env.date || '');
            const snippet = String(env.snippet || '');
            const bodies = { bodyPlain: env.bodyPlain, bodyHtml: env.bodyHtml } as any;

            // 1. Filter evaluation
            const sFilters = beginSpan(traceId, { type: 'filters_eval', name: 'evaluateFilters', provider: account.provider, emailId: msgId, request: { filtersCount: filters.length } });
            const filterEvaluations = evaluateFilters(filters, { from, subject, bodyPlain: bodies.bodyPlain, bodyHtml: bodies.bodyHtml, snippet, date });
            endSpan(traceId, sFilters, { status: 'ok', response: { matches: filterEvaluations.filter(e => e.match).length } });

            // 2. Director selection with duplicate control
            const sSelect = beginSpan(traceId, { type: 'director_select', name: 'selectDirectorTriggers', provider: account.provider, emailId: msgId });
            const directorTriggers: string[] = selectDirectorTriggers(filterEvaluations);
            endSpan(traceId, sSelect, { status: 'ok', response: { triggers: directorTriggers } });

            for (const directorId of directorTriggers) {
              const director = directors.find(d => d.id === directorId);
              if (!director) continue;
              const emailEnvelope = { id: msgId, subject, from, date, snippet, bodyPlain: bodies.bodyPlain, bodyHtml: bodies.bodyHtml, attachments: [] as any[] };
              const directorPrompt = deps.getPrompts().find(p => p.id === director.promptId);
              const dirThreadId = newId();
              const nowIso = new Date().toISOString();
              const dirThread: ConversationThread = {
                id: dirThreadId,
                kind: 'director',
                directorId: director.id,
                traceId,
                email: emailEnvelope as any,
                promptId: director.promptId || '',
                apiConfigId: director.apiConfigId,
                startedAt: nowIso,
                status: 'ongoing',
                lastActiveAt: nowIso,
                messages: directorPrompt?.messages ? [...directorPrompt.messages] : [],
                errors: [],
                workspaceItems: [],
                finalized: false,
              } as ConversationThread;
              conversations = [...deps.getConversations(), dirThread];
              deps.setConversations(conversations);
              // Conversation creation span
              const sConvCreate = beginSpan(traceId, { type: 'conversation_update', name: 'create_director_thread', emailId: msgId, directorId: director.id });
              endSpan(traceId, sConvCreate, { status: 'ok' });

              const dirApi = settings.apiConfigs.find((c: any) => c.id === director.apiConfigId);
              if (!dirApi || !directorPrompt) {
                const i = conversations.findIndex(c => c.id === dirThreadId);
                if (i !== -1) {
                  const updated = { ...conversations[i], status: 'failed', endedAt: new Date().toISOString(), errors: ['Missing director apiConfig or prompt'] } as any;
                  conversations = [...conversations.slice(0, i), updated, ...conversations.slice(i + 1)];
                  deps.setConversations(conversations);
                }
                // Span: director thread failure
                try {
                  const sFail = beginSpan(traceId, { type: 'conversation_update', name: 'director_thread_fail', emailId: msgId, directorId: director.id });
                  endSpan(traceId, sFail, { status: 'error', error: 'missing director apiConfig or prompt' });
                } catch {}
                endTrace(traceId, 'error', 'missing director apiConfig or prompt');
                continue;
              }

              let dirMsgs: any[] = [...(directorPrompt.messages || [])];
              const emailContextMsg = { role: 'user', content: `Email context\nsubject: ${subject}\nfrom: ${from}\ndate: ${date}\nsnippet: ${snippet}`, context: { traceId } } as any;
              dirMsgs.push(emailContextMsg);
              {
                const di0 = conversations.findIndex(c => c.id === dirThreadId);
                if (di0 !== -1) {
                  const updated = { ...conversations[di0], messages: [...(conversations[di0].messages || []), emailContextMsg] } as any;
                  conversations = [...conversations.slice(0, di0), updated, ...conversations.slice(di0 + 1)];
                  deps.setConversations(conversations);
                }
              }

              deps.logOrch({ timestamp: new Date().toISOString(), director: director.id, directorName: director.name, agent: '', agentName: '', emailSummary: subject || snippet || msgId, accountId: account.id, email: emailEnvelope as any, result: null, detail: { action: 'director_start' }, fetchCycleId: fetchStart, dirThreadId, phase: 'director' });

              const dirIdx = conversations.findIndex(c => c.id === dirThreadId);
              const appendDirTool = (msg: any) => {
                dirMsgs.push(msg);
                if (dirIdx !== -1) {
                  const updated = { ...conversations[dirIdx], messages: [...(conversations[dirIdx].messages || []), msg] } as any;
                  conversations = [...conversations.slice(0, dirIdx), updated, ...conversations.slice(dirIdx + 1)];
                  deps.setConversations(conversations);
                }
              };

              let loopGuard = 0;
              const LOOP_MAX = 8;
              while (loopGuard++ < LOOP_MAX) {
                const t0 = Date.now();
                const sLlm = beginSpan(traceId, { type: 'llm_call', name: 'director_chatCompletion', directorId: director.id, emailId: msgId });
                let step: any;
                let latencyMs = 0;
                try {
                  // Use unified engine; dynamic agent tools synthesized via context.agents when canSpawnAgents=true
                  const engineOut = await conversationEngine.run({
                    messages: dirMsgs as any,
                    apiConfig: dirApi as any,
                    role: 'director',
                    roleCaps: { canSpawnAgents: true },
                    toolRegistry: TOOL_DESCRIPTORS,
                    context: { conversationId: dirThreadId, traceId, agents },
                  });
                  step = {
                    assistantMessage: engineOut.assistantMessage,
                    toolCalls: engineOut.toolCalls,
                    request: engineOut.request,
                    response: engineOut.response,
                  } as any;
                  latencyMs = Date.now() - t0;
                  endSpan(traceId, sLlm, { status: 'ok', response: { latencyMs } });
                } catch (e: any) {
                  latencyMs = Date.now() - t0;
                  endSpan(traceId, sLlm, { status: 'error', error: String(e?.message || e) });
                  try {
                    const now = new Date().toISOString();
                    deps.logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'error', timestamp: now, latencyMs, error: String(e?.message || e) });
                  } catch {}
                  break; // exit director loop on LLM failure
                }
                if (dirIdx !== -1) {
                  const assistantWithCtx = { ...(step.assistantMessage as any), context: { ...(step.assistantMessage as any)?.context, traceId, spanId: sLlm } };
                  const updated = { ...conversations[dirIdx], provider: 'openai', messages: [...(conversations[dirIdx].messages || []), assistantWithCtx] } as any;
                  conversations = [...conversations.slice(0, dirIdx), updated, ...conversations.slice(dirIdx + 1)];
                  deps.setConversations(conversations);
                }
                try {
                  const now = new Date().toISOString();
                  if (step.request) deps.logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'request', timestamp: now, payload: step.request });
                  const usage = (step.response as any)?.usage;
                  deps.logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'response', timestamp: now, latencyMs, usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined, payload: step.response });
                } catch {}

                dirMsgs.push(step.assistantMessage as any);
                if (!step.toolCalls || step.toolCalls.length === 0) {
                  // Span: director final assistant message (no tool calls)
                  try {
                    const sFinalMsg = beginSpan(traceId, { type: 'conversation_update', name: 'director_final_message', directorId: director.id, emailId: msgId });
                    endSpan(traceId, sFinalMsg, { status: 'ok', response: { contentPreview: String(step.assistantMessage?.content || '').slice(0, 200) } });
                  } catch {}
                  break;
                }

                for (const tc of step.toolCalls) {
                  let args: any = {};
                  try { args = tc.arguments ? JSON.parse(tc.arguments) : {}; }
                  catch (e: any) {
                    // Span: malformed tool args
                    try {
                      const sArgs = beginSpan(traceId, { type: 'tool_call', name: tc.name || 'unknown', directorId: director.id, emailId: msgId, toolCallId: tc.id });
                      endSpan(traceId, sArgs, { status: 'error', error: `invalid tool arguments: ${String(e?.message || e)}` });
                    } catch {}
                    appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'invalid tool arguments' }) });
                    continue;
                  }
                  if (tc.name && (tc.name.startsWith('agent__') || tc.name.startsWith('actor__'))) {
                    const agentId = tc.name.replace(/^(agent__|actor__)/, '');
                    const agent = agents.find(a => a.id === agentId);
                    if (!agent) { appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'agent not found' }) }); continue; }
                    const sTool = beginSpan(traceId, { type: 'tool_call', name: tc.name, directorId: director.id, agentId, emailId: msgId, request: { args } });
                    const ensured = ensureAgentThread(
                      conversations,
                      dirThreadId,
                      director,
                      agent,
                      emailEnvelope,
                      deps.getPrompts(),
                      settings.apiConfigs,
                      { isDirectorFinalized: deps.isDirectorFinalized },
                      new Date().toISOString(),
                      () => newId(),
                      traceId,
                    );
                    if ('error' in ensured) {
                      appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: ensured.error, reason: ensured.reason }) });
                      conversations = ensured.conversations;
                      deps.setConversations(conversations);
                      endSpan(traceId, sTool, { status: 'error', error: ensured.error });
                      continue;
                    }
                    conversations = ensured.conversations;
                    deps.setConversations(conversations);
                    const agentThread = ensured.agentThread;
                    const isNew = ensured.isNew;

                    deps.logOrch({ timestamp: new Date().toISOString(), director: director.id, directorName: director.name, agent: agent.id, agentName: agent.name, emailSummary: subject || snippet || msgId, accountId: account.id, email: emailEnvelope as any, result: { content: `agentThreadId=${agentThread.id}; isNew=${isNew}`, attachments: [], notifications: [] }, detail: { tool: 'agent', agentId: agent.id, agentName: agent.name, agentThreadId: agentThread.id, isNew }, fetchCycleId: fetchStart, dirThreadId, agentThreadId: agentThread.id, phase: 'tool' });

                    const agentApi = settings.apiConfigs.find((c: any) => c.id === agent.apiConfigId)!;
                    const sAgentLlm = beginSpan(traceId, { type: 'llm_call', name: 'agent_conversation', directorId: director.id, agentId, emailId: msgId });
                    const tAg0 = Date.now();
                    
                    try {
                      // Use unified agent conversation logic
                      const { runAgentConversation } = require('./orchestration');
                      const agentInput = String(args.input || '');
                      
                      const agentResult = await runAgentConversation(
                        agentThread,
                        agentInput,
                        conversations,
                        agentApi,
                        TOOL_DESCRIPTORS,
                        (next: ConversationThread[]) => {
                          conversations = next;
                          deps.setConversations(next);
                        },
                        traceId,
                        deps.logProviderEvent // Add provider event logging
                      );
                      
                      const latencyMs = Date.now() - tAg0;
                      conversations = agentResult.conversations;
                      
                      if (agentResult.success) {
                        endSpan(traceId, sAgentLlm, { status: 'ok', response: { latencyMs } });
                        // Return final agent response to director
                        const finalContent = agentResult.finalAssistantMessage?.content || '';
                        appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalContent), context: { traceId, spanId: sTool } } as any);
                        endSpan(traceId, sTool, { status: 'ok' });
                      } else {
                        endSpan(traceId, sAgentLlm, { status: 'error', error: agentResult.error });
                        appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: agentResult.error || 'agent conversation failed' }) });
                        endSpan(traceId, sTool, { status: 'error', error: agentResult.error || 'agent conversation failed' });
                      }
                    } catch (e: any) {
                      const latencyMs = Date.now() - tAg0;
                      endSpan(traceId, sAgentLlm, { status: 'error', error: String(e?.message || e) });
                      try {
                        const now = new Date().toISOString();
                        deps.logProviderEvent({ id: newId(), conversationId: agentThread.id, provider: 'openai', type: 'error', timestamp: now, latencyMs, error: String(e?.message || e) });
                      } catch {}
                      appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'agent conversation failed' }) });
                      endSpan(traceId, sTool, { status: 'error', error: 'agent conversation failed' });
                      continue;
                    }
                  } else {
                    // Span: unsupported tool
                    try {
                      const sUnsupported = beginSpan(traceId, { type: 'tool_call', name: tc.name || 'unknown', directorId: director.id, emailId: msgId, toolCallId: tc.id });
                      endSpan(traceId, sUnsupported, { status: 'error', error: 'tool not implemented' });
                    } catch {}
                    appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'tool not implemented' }) });
                  }
                }
              }

              // Finalization policy
              const finalized = shouldFinalizeDirector();
              if (finalized) {
                const di = conversations.findIndex(c => c.id === dirThreadId);
                if (di !== -1) {
                  // Span: director thread finalization
                  let sFinalize = '';
                  try { sFinalize = beginSpan(traceId, { type: 'conversation_update', name: 'finalize_director_thread', emailId: msgId, directorId: director.id }); } catch {}
                  const updated = { ...conversations[di], status: 'completed', endedAt: new Date().toISOString(), finalized: true } as any;
                  conversations = [...conversations.slice(0, di), updated, ...conversations.slice(di + 1)];
                  deps.setConversations(conversations);
                  try { if (sFinalize) endSpan(traceId, sFinalize, { status: 'ok' }); } catch {}

                  // Cascade finalization to child agent threads of this director
                  const childAgents = conversations
                    .filter(c => c.kind === 'agent' && c.parentId === dirThreadId && !c.finalized);
                  if (childAgents.length > 0) {
                    let sCascade = '';
                    try { sCascade = beginSpan(traceId, { type: 'conversation_update', name: 'finalize_child_agent_threads', emailId: msgId, directorId: director.id }); } catch {}
                    const now = new Date().toISOString();
                    conversations = conversations.map(c => (
                      c.kind === 'agent' && c.parentId === dirThreadId && !c.finalized
                        ? ({ ...c, status: 'completed', endedAt: now, finalized: true } as any)
                        : c
                    ));
                    deps.setConversations(conversations);
                    try { if (sCascade) endSpan(traceId, sCascade, { status: 'ok', response: { count: childAgents.length } }); } catch {}
                  }
                }
              }
              endTrace(traceId, 'ok');
            }
          }
        }
        fetcherAccountStatus[account.id].lastRun = new Date().toISOString();
        fetcherAccountStatus[account.id].lastError = null;
        logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'account_complete', message: 'Account fetch completed' });
        endTrace(accountTraceId, 'ok');
      } catch (err: any) {
        fetcherAccountStatus[account.id].lastError = String(err);
        logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'account_error', message: 'Error during fetch', detail: String(err) });
        endTrace(accountTraceId, 'error', String(err));
      }
    }

    const fetchEnd = new Date().toISOString();
    logFetch({ timestamp: fetchEnd, level: 'info', event: 'cycle_complete', message: 'Fetch cycle complete', count: accounts.length });
    if (fetcherActive) {
      fetcherNextRun = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    fetcherRunning = false;
  }

  function startFetcherLoop() {
    if (fetcherActive) return;
    fetcherActive = true;
    fetcherNextRun = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    fetcherInterval = setInterval(() => { void fetchEmails(); }, 5 * 60 * 1000);
  }

  function stopFetcherLoop() {
    fetcherActive = false;
    fetcherNextRun = null;
    if (fetcherInterval) { clearInterval(fetcherInterval); fetcherInterval = null; }
  }

  return {
    getStatus: () => ({ active: fetcherActive, running: fetcherRunning, lastRun: fetcherLastRun, nextRun: fetcherNextRun, accountStatus: fetcherAccountStatus }),
    startFetcherLoop,
    stopFetcherLoop,
    fetchEmails,
    getFetcherLog: () => fetcherLog,
    setFetcherLog: (next: FetcherLogEntry[]) => {
      const before = fetcherLog.length;
      // Normalize: ensure entries have ids
      fetcherLog = (next || []).map(e => ({ ...e, id: e.id || newId() }));
      try {
        persistence.encryptAndPersist(fetcherLog, FETCHER_LOG_FILE);
        console.log(`[${new Date().toISOString()}] [FETCHER] setFetcherLog: ${before} -> ${fetcherLog.length}`);
      } catch (e) {
        console.error('[ERROR] Failed to persist fetcherLog after setFetcherLog:', e);
      }
    },
  };
}
