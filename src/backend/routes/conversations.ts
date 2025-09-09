import express from 'express';
import { ConversationThread, PromptMessage, ProviderEvent } from '../../shared/types';
import { conversationEngine } from '../services/engine';
import { runAgentConversation } from '../services/orchestration-agent';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { createToolHandler } from '../toolCalls';
import logger from '../services/logger';
import { ProviderEventLogger } from '../services/logging-handlers';
import { requireReq, requireRepos } from '../utils/repo-access';
import type { ReqLike } from '../utils/repo-access';
import { LiveRepos } from '../liveRepos';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import { transformMessagesForEngine, extractLastUserContent } from '../utils/message-transformers';

interface ConversationResult {
  assistantMessage: PromptMessage | null;
  content?: string;
  toolCalls?: any[];
}

async function validateConversationRequest(
  id: string, 
  req: ReqLike, 
  repos: LiveRepos
): Promise<{ thread: ConversationThread; apiConfig: any }> {
  const conversations = await repos.getConversations(req);
  const thread = conversations.find((c) => c.id === id);
  if (!thread) throw new NotFoundError('Conversation not found');

  const apiConfig = (await repos.getSettings(requireReq(req))).apiConfigs.find((c: any) => c.id === thread.apiConfigId);
  if (!apiConfig) throw new NotFoundError('API config not found');

  return { thread, apiConfig };
}


async function processDirectorConversation(
  thread: ConversationThread,
  messages: any[],
  apiConfig: any,
  req: ReqLike,
  repos: LiveRepos,
): Promise<ConversationResult> {
  const t0 = Date.now();
  const provLogger = new ProviderEventLogger(req as any);
  const engineOut = await conversationEngine.run({
    messages: messages as any,
    apiConfig: apiConfig as any,
    role: 'director',
    roleCaps: { canSpawnAgents: true },
    toolRegistry: TOOL_DESCRIPTORS,
    context: { conversationId: thread.id, agents: await repos.getAgents(req) },
  });
  
  const result = {
    assistantMessage: engineOut.assistantMessage,
    toolCalls: engineOut.toolCalls,
    content: engineOut.content,
    request: engineOut.request,
    response: engineOut.response,
  } as any;
  
  const latencyMs = Date.now() - t0;
  await updateDirectorThread(thread, result.assistantMessage, req, repos);
  // Centralized provider-event logging via ProviderEventLogger
  if (result.request) {
    provLogger.logRequest(thread.id, result.request);
  }
  if (result.response) {
    provLogger.logResponse(thread.id, latencyMs, result.response, result.response?.usage);
  }

  return {
    assistantMessage: result.assistantMessage,
    content: result.content,
    toolCalls: result.toolCalls
  };
}

async function processAgentConversation(
  thread: ConversationThread,
  messages: any[],
  apiConfig: any,
  req: ReqLike,
  repos: LiveRepos,
): Promise<ConversationResult> {
  const userContent = extractLastUserContent(messages);
  const provLogger = new ProviderEventLogger(req as any);
  
  const agentResult = await runAgentConversation(
    thread,
    userContent,
    await repos.getConversations(req),
    apiConfig,
    TOOL_DESCRIPTORS,
    async (next: ConversationThread[]) => { await repos.setConversations(req, next); },
    createToolHandler(requireRepos(requireReq(req))),
    undefined,
    async (ev: ProviderEvent) => {
      try {
        const t = (ev as any).type;
        if (t === 'request') {
          provLogger.logRequest(thread.id, (ev as any).payload);
        } else if (t === 'response') {
          provLogger.logResponse(
            thread.id,
            (ev as any).latencyMs,
            (ev as any).payload,
            (ev as any).usage
          );
        } else if (t === 'error') {
          provLogger.logError(
            thread.id,
            String((ev as any).error),
            (ev as any).latencyMs
          );
        } else {
          logger.warn('Unknown provider event type', { type: t, conversationId: thread.id });
        }
      } catch (e: any) {
        logger.warn('Provider event logging failed in conversations route', {
          error: e?.message || String(e),
          conversationId: thread.id,
        });
      }
    }
  );
  
  if (!agentResult.success) {
    throw new Error(agentResult.error || 'Agent conversation failed');
  }
  
  return {
    assistantMessage: agentResult.finalAssistantMessage,
    content: agentResult.finalAssistantMessage?.content
  };
}

async function updateDirectorThread(
  thread: ConversationThread,
  assistantMessage: PromptMessage,
  req: ReqLike,
  repos: LiveRepos
): Promise<void> {
  const now = new Date().toISOString();
  const updated: ConversationThread = {
    ...thread,
    messages: [...thread.messages, assistantMessage],
    lastActiveAt: now,
    provider: 'openai',
  } as any;
  
  const conversations = await repos.getConversations(req);
  const idx = conversations.findIndex((c) => c.id === thread.id);
  if (idx !== -1) {
    const next = conversations.slice();
    next[idx] = updated;
    await repos.setConversations(req, next);
  }
}
export default function registerConversationsRoutes(
  app: express.Express, 
  repos: LiveRepos,
) {
  // LIST conversations (canonical). Supports optional pagination only; no filters, no sorting.
  // GET /api/conversations?limit=&offset=
  app.get('/api/conversations', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const q = req.query as Record<string, string>;
    const list = await repos.getConversations(req as any as ReqLike);
    const limit = Math.max(0, Math.min(1000, Number(q.limit) || 200));
    const offset = Math.max(0, Number(q.offset) || 0);
    const paged = list.slice(offset, offset + limit);
    return res.json({ total: list.length, items: paged });
  }));

  // GET single conversation by id
  app.get('/api/conversations/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const list = await repos.getConversations(req as any as ReqLike);
    const thread = list.find((c) => c.id === id);
    if (!thread) throw new NotFoundError('Conversation not found');
    return res.json(thread);
  }));

  // GET /api/conversations/byDirectorEmail?directorId=&emailId=
  app.get('/api/conversations/byDirectorEmail', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const directorId = String(req.query.directorId || '').trim();
    const emailId = String(req.query.emailId || '').trim();
    if (!directorId || !emailId) throw new ValidationError('directorId and emailId are required');
    const threads = (await repos.getConversations(req as any as ReqLike)).filter(
      (c) => c.kind === 'director' && c.directorId === directorId && (c.email as any)?.id === emailId
    );
    if (!threads.length) throw new NotFoundError('Conversation not found');
    // Pick the last matching thread in canonical insertion order
    const thread = threads[threads.length - 1];
    return res.json(thread);
  }));

  // POST /api/conversations/:id/messages  { content: string }
  app.post('/api/conversations/:id/messages', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const content = String(req.body?.content || '');
    if (!content.trim()) throw new ValidationError('Message content is required');
    const conversations = await repos.getConversations(req as any as ReqLike);
    const idx = conversations.findIndex((c) => c.id === id);
    if (idx === -1) throw new NotFoundError('Conversation not found');
    const t = conversations[idx];
    const now = new Date().toISOString();
    const msg: PromptMessage = { role: 'user', content };
    const updated: ConversationThread = {
      ...t,
      messages: [...t.messages, msg],
      lastActiveAt: now,
    };
    const next = conversations.slice();
    next[idx] = updated;
    await repos.setConversations(req as any as ReqLike, next);
    logger.info('POST /api/conversations/:id/messages appended user message', { id, length: content.length });
    return res.json({ success: true });
  }));

  // POST /api/conversations/:id/assistant
  app.post('/api/conversations/:id/assistant', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const reqLike = req as any as ReqLike;
    
    const { thread, apiConfig } = await validateConversationRequest(id, reqLike, repos);
    const messages = transformMessagesForEngine(thread.messages);
    
    let result: ConversationResult;
    if (thread.kind === 'director') {
      result = await processDirectorConversation(thread, messages, apiConfig, reqLike, repos);
    } else {
      result = await processAgentConversation(thread, messages, apiConfig, reqLike, repos);
    }

    logger.info('POST /api/conversations/:id/assistant replied', { id, length: String(result.content || '').length });
    return res.json({ 
      success: true, 
      message: result.assistantMessage, 
      content: result.content, 
      toolCalls: result.toolCalls 
    });
  }));

  // DELETE single conversation by id
  app.delete('/api/conversations/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as any as ReqLike);
    const list = await repos.getConversations(ureq);
    const next = list.filter((c) => c.id !== id);
    const deleted = list.length - next.length;
    if (deleted === 0) throw new NotFoundError('Conversation not found');
    await repos.setConversations(ureq, next);
    return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
  }));

  // BULK DELETE conversations by ids array
  app.delete('/api/conversations', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (!ids.length) throw new ValidationError('No ids provided');
    const ureq = requireReq(req as any as ReqLike);
    const list = await repos.getConversations(ureq);
    const set = new Set(ids);
    const next = list.filter((c) => !c.id || !set.has(c.id));
    const deleted = list.length - next.length;
    await repos.setConversations(ureq, next);
    return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
  }));
}

