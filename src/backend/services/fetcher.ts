import { getMailProvider } from '../providers/mail';
import { newId } from '../utils/id';
import { conversationEngine } from './engine';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { Account, ConversationThread, FetcherLogEntry, OrchestrationDiagnosticEntry, ProviderEvent } from '../../shared/types';
import { evaluateFilters, selectDirectorTriggers, shouldFinalizeDirector, ensureAgentThread, runAgentConversation, logConversationStepDiagnostic } from './orchestration';
import { FETCHER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE, PROVIDER_REQUEST_TIMEOUT_MS, CONVERSATION_STEP_TIMEOUT_MS } from '../config';
import { beginTrace, endTrace, beginSpan, endSpan } from './logging';
import type { ReqLike } from '../interfaces';
import { LiveRepos } from '../liveRepos';
import logger from './logger';

/** Interface for the fetcher service. */
export interface FetcherService {
  getStatus: () => { active: boolean; running: boolean; lastRun: string | null; nextRun: string | null; accountStatus: Record<string, { lastRun: string | null; lastError: string | null }> };
  startFetcherLoop: () => void;
  stopFetcherLoop: () => void;
  fetchEmails: () => Promise<void>;
  getFetcherLog: () => FetcherLogEntry[];
  setFetcherLog: (next: FetcherLogEntry[]) => void;
}

/** Initialize the background fetcher. */
export function initFetcher(
  repos: LiveRepos,
  userReq: ReqLike,
  logOrch: (e: OrchestrationDiagnosticEntry) => void,
  logProviderEvent: (e: ProviderEvent) => void,
  getToolHandler: () => (name: string, params: any) => Promise<any>
): FetcherService {
  let fetcherActive = false;
  let fetcherInterval: NodeJS.Timeout | null = null;
  let fetcherLastRun: string | null = null;
  let fetcherNextRun: string | null = null;
  let fetcherRunning = false;
  let fetcherLog: FetcherLogEntry[] = [];
  let fetcherAccountStatus: Record<string, { lastRun: string | null; lastError: string | null }> = {};

  function pruneFetcher(list: FetcherLogEntry[]): FetcherLogEntry[] {
    try {
      const ttlMs = Math.max(0, FETCHER_TTL_DAYS) * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let next = list;
      if (ttlMs > 0) {
        next = next.filter(e => {
          const ts = Date.parse(e.timestamp || '');
          return isNaN(ts) ? true : (now - ts) <= ttlMs;
        });
      }
      const cap = Math.max(0, USER_MAX_LOGS_PER_TYPE);
      if (cap > 0 && next.length > cap) {
        next = next.slice(Math.max(0, next.length - cap));
      }
      return next;
    } catch {
      return list;
    }
  }

  try {
    void repos.getFetcherLog(userReq)
      .then((list: FetcherLogEntry[]) => pruneFetcher(list.map((e: FetcherLogEntry) => ({ ...e, id: e.id || newId() }))))
      .then((list: FetcherLogEntry[]) => { fetcherLog = list; })
      .catch((e: any) => { logger.error('Failed to initialize fetcherLog', { err: e }); });
  } catch (e) {
    logger.error('Failed to initialize fetcherLog', { err: e });
  }

  function logFetch(entry: FetcherLogEntry) {
    try {
      const withId: FetcherLogEntry = { ...entry, id: entry.id || newId() };
      fetcherLog.push(withId);
      fetcherLog = pruneFetcher(fetcherLog);
      repos.setFetcherLog(userReq, fetcherLog);
    } catch (e) {
      logger.error('Failed to persist fetcherLog entry', { err: e });
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

    const settings = await repos.getSettings(userReq);
    const filters = await repos.getFilters(userReq);
    const directors = await repos.getDirectors(userReq);
    const agents = await repos.getAgents(userReq);
    let conversations = await repos.getConversations(userReq);

    let accounts: Account[] = [];
    try {
      accounts = await repos.getAccounts(userReq);
      logFetch({ timestamp: new Date().toISOString(), level: 'debug', event: 'accounts_loaded', message: `Loaded ${accounts.length} accounts from store`, count: accounts.length });
    } catch (e) {
      logFetch({ timestamp: new Date().toISOString(), level: 'error', event: 'accounts_load_error', message: 'Error loading accounts', detail: String(e) });
      fetcherRunning = false;
      return;
    }

    for (const account of accounts) {
      const accountTraceId = beginTrace({ accountId: account.id, provider: account.provider }, userReq);
      if (!fetcherAccountStatus[account.id]) fetcherAccountStatus[account.id] = { lastRun: null, lastError: null };
      try {
        logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'account_start', message: 'Fetching emails...' });
        if (account.provider === 'gmail' || account.provider === 'outlook') {
          const provider = getMailProvider(account.provider);
          if (!provider) {
            logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'provider_missing', message: `${account.provider} provider not available` });
            continue;
          }
          const sRefresh = beginSpan(accountTraceId, { type: 'token_refresh', name: 'ensureValidAccessToken', provider: account.provider }, userReq);
          const refreshResult = await provider.ensureValidAccessToken(account);
          endSpan(accountTraceId, sRefresh, { status: (refreshResult as any)?.error ? 'error' : 'ok', error: (refreshResult as any)?.error }, userReq);
          if ((refreshResult as any)?.error) {
            const errMsg = (refreshResult as any).error;
            fetcherAccountStatus[account.id].lastError = errMsg;
            logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'oauth_refresh_error', message: 'Failed to refresh access token', detail: errMsg });
            continue;
          }
          if (refreshResult.updated) {
            account.tokens.accessToken = refreshResult.accessToken;
            account.tokens.expiry = refreshResult.expiry;
            const idx = accounts.findIndex((a: any) => a.id === account.id);
            if (idx !== -1) {
              const updatedAccounts = [...accounts];
              updatedAccounts[idx] = { ...updatedAccounts[idx], tokens: { ...account.tokens } };
              await repos.setAccounts(userReq, updatedAccounts);
              logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'oauth_refreshed', message: 'Refreshed and persisted new access token' });
            }
          }
          const sList = beginSpan(accountTraceId, { type: 'provider_fetch', name: 'fetchUnread', provider: account.provider }, userReq);
          let envelopes: any[] = [];
          try {
            let pTimeoutId: any;
            const p = provider.fetchUnread(account, { max: 10, unreadOnly: true });
            const pTimeout = new Promise<never>((_, reject) => {
              pTimeoutId = setTimeout(() => reject(new Error(`provider_fetch_timeout_${PROVIDER_REQUEST_TIMEOUT_MS}ms`)), Math.max(1, PROVIDER_REQUEST_TIMEOUT_MS || 0));
            });
            envelopes = await Promise.race([p, pTimeout]);
            clearTimeout(pTimeoutId);
            endSpan(accountTraceId, sList, { status: 'ok', response: { count: envelopes.length } }, userReq);
          } catch (e: any) {
            endSpan(accountTraceId, sList, { status: 'error', error: String(e?.message || e) }, userReq);
            logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'provider_fetch_error', message: 'Failed to list unread messages', detail: String(e?.message || e) });
            continue;
          }
          logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'messages_listed', message: 'Listed unread messages', count: envelopes.length });

          for (const env of envelopes) {
            const traceId = beginTrace({ emailId: env.id, accountId: account.id, provider: account.provider }, userReq);
            const msgId = env.id;
            const subject = String(env.subject || '');
            const from = String(env.from || '');
            const date = String(env.date || '');
            const snippet = String(env.snippet || '');
            const bodies = { bodyPlain: env.bodyPlain, bodyHtml: env.bodyHtml } as any;

            const sFilters = beginSpan(traceId, { type: 'filters_eval', name: 'evaluateFilters', provider: account.provider, emailId: msgId, request: { filtersCount: filters.length } }, userReq);
            const filterEvaluations = evaluateFilters(filters, { from, subject, bodyPlain: bodies.bodyPlain, bodyHtml: bodies.bodyHtml, snippet, date });
            endSpan(traceId, sFilters, { status: 'ok', response: { matches: filterEvaluations.filter(e => e.match).length } }, userReq);

            const sSelect = beginSpan(traceId, { type: 'director_select', name: 'selectDirectorTriggers', provider: account.provider, emailId: msgId }, userReq);
            const directorTriggers: string[] = selectDirectorTriggers(filterEvaluations);
            endSpan(traceId, sSelect, { status: 'ok', response: { triggers: directorTriggers } }, userReq);

            for (const directorId of directorTriggers) {
              const director = directors.find(d => d.id === directorId);
              if (!director) continue;
              const emailEnvelope = { id: msgId, subject, from, date, snippet, bodyPlain: bodies.bodyPlain, bodyHtml: bodies.bodyHtml, attachments: [] as any[] };
              const prompts = await repos.getPrompts();
              const directorPrompt = prompts.find(p => p.id === director.promptId);
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
              conversations = [...(await repos.getConversations()), dirThread];
              await repos.setConversations(userReq, conversations);
              const sConvCreate = beginSpan(traceId, { type: 'conversation_update', name: 'create_director_thread', emailId: msgId, directorId: director.id }, userReq);
              endSpan(traceId, sConvCreate, { status: 'ok' }, userReq);

              const dirApi = settings.apiConfigs.find((c: any) => c.id === director.apiConfigId);
              if (!dirApi || !directorPrompt) {
                const i = conversations.findIndex(c => c.id === dirThreadId);
                if (i !== -1) {
                  const updated = { ...conversations[i], status: 'failed', endedAt: new Date().toISOString(), errors: ['Missing director apiConfig or prompt'] } as any;
                  conversations = [...conversations.slice(0, i), updated, ...conversations.slice(i + 1)];
                  await repos.setConversations(userReq, conversations);
                }
                try {
                  const sFail = beginSpan(traceId, { type: 'conversation_update', name: 'director_thread_fail', emailId: msgId, directorId: director.id }, userReq);
                  endSpan(traceId, sFail, { status: 'error', error: 'missing director apiConfig or prompt' }, userReq);
                } catch {}
                endTrace(traceId, 'error', 'missing director apiConfig or prompt', userReq);
                continue;
              }

              let dirMsgs: any[] = [...directorPrompt.messages];
              const emailContextMsg = { role: 'user', content: `Email context\nsubject: ${subject}\nfrom: ${from}\ndate: ${date}\nsnippet: ${snippet}`, context: { traceId } } as any;
              dirMsgs.push(emailContextMsg);
              {
                const di0 = conversations.findIndex(c => c.id === dirThreadId);
                if (di0 !== -1) {
                  const updated = { ...conversations[di0], messages: [...conversations[di0].messages, emailContextMsg] } as any;
                  conversations = [...conversations.slice(0, di0), updated, ...conversations.slice(di0 + 1)];
                  await repos.setConversations(userReq, conversations);
                }
              }

              logOrch({ timestamp: new Date().toISOString(), director: director.id, directorName: director.name, agent: '', agentName: '', emailSummary: subject || snippet || msgId, accountId: account.id, email: emailEnvelope as any, result: null, detail: { action: 'director_start' }, fetchCycleId: fetchStart, dirThreadId, phase: 'director' });
              logConversationStepDiagnostic('director_start', dirThreadId, { directorId: director.id, emailId: msgId, loopGuard: 0 }, logOrch);

              const dirIdx = conversations.findIndex(c => c.id === dirThreadId);
              const appendDirTool = async (msg: any) => {
                dirMsgs.push(msg);
                if (dirIdx !== -1) {
                  const updated = { ...conversations[dirIdx], messages: [...conversations[dirIdx].messages, msg] } as any;
                  conversations = [...conversations.slice(0, dirIdx), updated, ...conversations.slice(dirIdx + 1)];
                  await repos.setConversations(userReq, conversations);
                }
              };

              let loopGuard = 0;
              const LOOP_MAX = 8;
              while (loopGuard++ < LOOP_MAX) {
                logConversationStepDiagnostic('director_llm', dirThreadId, { directorId: director.id, emailId: msgId, loopGuard, maxLoops: LOOP_MAX }, logOrch);
                const t0 = Date.now();
                const sLlm = beginSpan(traceId, { type: 'llm_call', name: 'director_chatCompletion', directorId: director.id, emailId: msgId }, userReq);
                let step: any;
                let latencyMs = 0;
                try {
                  let stepTimeoutId: any;
                  const stepPromise = conversationEngine.run({
                    messages: dirMsgs as any,
                    apiConfig: dirApi as any,
                    role: 'director',
                    roleCaps: { canSpawnAgents: true },
                    toolRegistry: TOOL_DESCRIPTORS,
                    context: { conversationId: dirThreadId, traceId, agents },
                  });
                  const stepTimeoutPromise = new Promise<never>((_, reject) => {
                    stepTimeoutId = setTimeout(() => reject(new Error(`conversation_step_timeout_${CONVERSATION_STEP_TIMEOUT_MS}ms`)), Math.max(1, CONVERSATION_STEP_TIMEOUT_MS || 0));
                  });
                  const engineOut = await Promise.race([stepPromise, stepTimeoutPromise]) as any;
                  clearTimeout(stepTimeoutId);
                  step = {
                    assistantMessage: engineOut.assistantMessage,
                    toolCalls: engineOut.toolCalls,
                    request: engineOut.request,
                    response: engineOut.response,
                  } as any;
                  latencyMs = Date.now() - t0;
                  endSpan(traceId, sLlm, { status: 'ok', response: { latencyMs } }, userReq);
                } catch (e: any) {
                  latencyMs = Date.now() - t0;
                  endSpan(traceId, sLlm, { status: 'error', error: String(e?.message || e) }, userReq);
                  try {
                    const now = new Date().toISOString();
                    logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'error', timestamp: now, latencyMs, error: String(e?.message || e) });
                  } catch {}
                  break;
                }
                if (dirIdx !== -1) {
                  const assistantWithCtx = { ...(step.assistantMessage as any), context: { ...(step.assistantMessage as any)?.context, traceId, spanId: sLlm } };
                  const updated = { ...conversations[dirIdx], provider: 'openai', messages: [...conversations[dirIdx].messages, assistantWithCtx] } as any;
                  conversations = [...conversations.slice(0, dirIdx), updated, ...conversations.slice(dirIdx + 1)];
                  await repos.setConversations(userReq, conversations);
                }
                try {
                  const now = new Date().toISOString();
                  if (step.request) logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'request', timestamp: now, payload: step.request });
                  const usage = (step.response as any)?.usage;
                  logProviderEvent({ id: newId(), conversationId: dirThreadId, provider: 'openai', type: 'response', timestamp: now, latencyMs, usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined, payload: step.response });
                } catch {}

                dirMsgs.push(step.assistantMessage as any);
                if (!step.toolCalls || step.toolCalls.length === 0) {
                  logConversationStepDiagnostic('director_finalize', dirThreadId, { directorId: director.id, emailId: msgId, loopGuard, reason: 'no_tool_calls' }, logOrch);
                  try {
                    const sFinalMsg = beginSpan(traceId, { type: 'conversation_update', name: 'director_final_message', directorId: director.id, emailId: msgId }, userReq);
                    endSpan(traceId, sFinalMsg, { status: 'ok', response: { contentPreview: String(step.assistantMessage?.content || '').slice(0, 200) } }, userReq);
                  } catch {}
                  break;
                }

                for (const tc of step.toolCalls) {
                  logConversationStepDiagnostic('director_tool', dirThreadId, { directorId: director.id, emailId: msgId, loopGuard, toolName: tc.name, toolCallId: tc.id }, logOrch);
                  let args: any = {};
                  try { args = tc.arguments ? JSON.parse(tc.arguments) : {}; }
                  catch { args = {}; }
                  if (tc.name && (tc.name.startsWith('agent__') || tc.name.startsWith('actor__'))) {
                    const agentId = tc.name.replace(/^(agent__|actor__)/, '');
                    const agent = agents.find(a => a.id === agentId);
                    if (!agent) { appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'agent not found' }) }); continue; }
                    const sTool = beginSpan(traceId, { type: 'tool_call', name: tc.name, directorId: director.id, agentId, emailId: msgId, request: { args } }, userReq);
                    const ensured = ensureAgentThread(
                      conversations,
                      dirThreadId,
                      director,
                      agent,
                      emailEnvelope,
                      await repos.getPrompts(),
                      settings.apiConfigs,
                      new Date().toISOString(),
                      () => newId(),
                      traceId,
                      userReq,
                    );
                    if ('error' in ensured) {
                      await appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: ensured.error, reason: ensured.reason }) });
                      conversations = ensured.conversations;
                      await repos.setConversations(userReq, conversations);
                      endSpan(traceId, sTool, { status: 'error', error: ensured.error }, userReq);
                      continue;
                    }
                    conversations = ensured.conversations;
                    await repos.setConversations(userReq, conversations);
                    const agentThread = ensured.agentThread;
                    const isNew = ensured.isNew;

                    logOrch({ timestamp: new Date().toISOString(), director: director.id, directorName: director.name, agent: agent.id, agentName: agent.name, emailSummary: subject || snippet || msgId, accountId: account.id, email: emailEnvelope as any, result: { content: `agentThreadId=${agentThread.id}; isNew=${isNew}`, attachments: [], notifications: [] }, detail: { tool: 'agent', agentId: agent.id, agentName: agent.name, agentThreadId: agentThread.id, isNew }, fetchCycleId: fetchStart, dirThreadId, agentThreadId: agentThread.id, phase: 'tool' });

                    const agentApi = settings.apiConfigs.find((c: any) => c.id === agent.apiConfigId)!;
                    const sAgentLlm = beginSpan(traceId, { type: 'llm_call', name: 'agent_conversation', directorId: director.id, agentId, emailId: msgId }, userReq);
                    const tAg0 = Date.now();
                    
                    try {
                      const agentInput = String(args.input || '');

                      const agentResult = await runAgentConversation(
                        agentThread,
                        agentInput,
                        conversations,
                        agentApi,
                        TOOL_DESCRIPTORS,
                        async (next: ConversationThread[]) => {
                          conversations = next;
                          await repos.setConversations(userReq, next);
                        },
                        getToolHandler(),
                        traceId,
                        logProviderEvent
                      );
                      
                      const latencyMs = Date.now() - tAg0;
                      conversations = agentResult.conversations;
                      
                      if (agentResult.success) {
                        endSpan(traceId, sAgentLlm, { status: 'ok', response: { latencyMs } }, userReq);
                        const finalContent = agentResult.finalAssistantMessage?.content || '';
                        appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalContent), context: { traceId, spanId: sTool } } as any);
                        endSpan(traceId, sTool, { status: 'ok' }, userReq);
                      } else {
                        endSpan(traceId, sAgentLlm, { status: 'error', error: agentResult.error }, userReq);
                        appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: agentResult.error || 'agent conversation failed' }) });
                        endSpan(traceId, sTool, { status: 'error', error: agentResult.error || 'agent conversation failed' }, userReq);
                      }
                    } catch (e: any) {
                      const latencyMs = Date.now() - tAg0;
                      endSpan(traceId, sAgentLlm, { status: 'error', error: String(e?.message || e) }, userReq);
                      try {
                        const now = new Date().toISOString();
                        logProviderEvent({ id: newId(), conversationId: agentThread.id, provider: 'openai', type: 'error', timestamp: now, latencyMs, error: String(e?.message || e) });
                      } catch {}
                      appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'agent conversation failed' }) });
                      endSpan(traceId, sTool, { status: 'error', error: 'agent conversation failed' }, userReq);
                      continue;
                    }
                  } else {
                    try {
                      const sUnsupported = beginSpan(traceId, { type: 'tool_call', name: tc.name || 'unknown', directorId: director.id, emailId: msgId, toolCallId: tc.id }, userReq);
                      endSpan(traceId, sUnsupported, { status: 'error', error: 'tool not implemented' }, userReq);
                    } catch {}
                    appendDirTool({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'tool not implemented' }) });
                  }
                }
              }

              const finalized = shouldFinalizeDirector();
              logConversationStepDiagnostic('director_finalize', dirThreadId, { directorId: director.id, emailId: msgId, shouldFinalize: finalized, reason: 'post_tool_loop' }, logOrch);
              if (finalized) {
                const di = conversations.findIndex(c => c.id === dirThreadId);
                if (di !== -1) {
                  let sFinalize = '';
                  try { sFinalize = beginSpan(traceId, { type: 'conversation_update', name: 'finalize_director_thread', emailId: msgId, directorId: director.id }, userReq); } catch {}
                  const updated = { ...conversations[di], status: 'completed', endedAt: new Date().toISOString(), finalized: true } as any;
                  conversations = [...conversations.slice(0, di), updated, ...conversations.slice(di + 1)];
                  await repos.setConversations(userReq, conversations);
                  try { if (sFinalize) endSpan(traceId, sFinalize, { status: 'ok' }, userReq); } catch {}

                  const childAgents = conversations
                    .filter(c => c.kind === 'agent' && c.parentId === dirThreadId && !c.finalized);
                  if (childAgents.length > 0) {
                    let sCascade = '';
                    try { sCascade = beginSpan(traceId, { type: 'conversation_update', name: 'finalize_child_agent_threads', emailId: msgId, directorId: director.id }, userReq); } catch {}
                    const now = new Date().toISOString();
                    conversations = conversations.map(c => (
                      c.kind === 'agent' && c.parentId === dirThreadId && !c.finalized
                        ? ({ ...c, status: 'completed', endedAt: now, finalized: true } as any)
                        : c
                    ));
                    await repos.setConversations(userReq, conversations);
                    try { if (sCascade) endSpan(traceId, sCascade, { status: 'ok', response: { count: childAgents.length } }, userReq); } catch {}
                  }
                }
              }
              endTrace(traceId, 'ok', undefined, userReq);
            }
          }
        }
        fetcherAccountStatus[account.id].lastRun = new Date().toISOString();
        fetcherAccountStatus[account.id].lastError = null;
        logFetch({ timestamp: new Date().toISOString(), level: 'info', provider: account.provider, accountId: account.id, event: 'account_complete', message: 'Account fetch completed' });
        endTrace(accountTraceId, 'ok', undefined, userReq);
      } catch (err: any) {
        fetcherAccountStatus[account.id].lastError = String(err);
        logFetch({ timestamp: new Date().toISOString(), level: 'error', provider: account.provider, accountId: account.id, event: 'account_error', message: 'Error during fetch', detail: String(err) });
        endTrace(accountTraceId, 'error', String(err), userReq);
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
    try {
      logFetch({ timestamp: new Date().toISOString(), level: 'info', event: 'loop_started', message: 'Fetcher loop started (5m interval)' });
    } catch {}
  }

  function stopFetcherLoop() {
    fetcherActive = false;
    fetcherNextRun = null;
    if (fetcherInterval) { clearInterval(fetcherInterval); fetcherInterval = null; }
    try {
      logFetch({ timestamp: new Date().toISOString(), level: 'info', event: 'loop_stopped', message: 'Fetcher loop stopped' });
    } catch {}
  }

  return {
    getStatus: () => ({ active: fetcherActive, running: fetcherRunning, lastRun: fetcherLastRun, nextRun: fetcherNextRun, accountStatus: fetcherAccountStatus }),
    startFetcherLoop,
    stopFetcherLoop,
    fetchEmails,
    getFetcherLog: () => fetcherLog,
    setFetcherLog: (next: FetcherLogEntry[]) => {
      const before = fetcherLog.length;
      fetcherLog = pruneFetcher(next.map(e => ({ ...e, id: e.id || newId() })));
      try {
        if (process.env.NODE_ENV !== 'production') {
          logger.debug('FETCHER setFetcherLog', { before, after: fetcherLog.length });
        }
      } catch (e) {
        logger.error('Failed after setFetcherLog', { err: e });
      }
    },
  };
}
