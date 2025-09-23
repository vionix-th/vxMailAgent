import express from 'express';
import { PromptMessage } from '../../shared/types';
import { requireReq } from '../utils/repo-access';
import type { ReqLike } from '../utils/repo-access';
import { LiveRepos } from '../liveRepos';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import { repoAppendMessage } from '../services/conversation-mutations';
import { newId } from '../utils/id';
import logger from '../services/logger';
import { ConversationOrchestrator, createUserRequest } from '../services/conversation-orchestrator';
import type { ConversationThread } from '../../shared/types';

interface ConversationResult {
  assistantMessage: PromptMessage | null;
  content?: string;
  toolCalls?: any[];
}

async function validateConversationRequest(
  id: string, 
  req: ReqLike, 
  repos: LiveRepos
): Promise<{ thread: ConversationThread }> {
  const conversations = await repos.getConversations(req);
  const thread = conversations.find((c) => c.id === id);
  if (!thread) throw new NotFoundError('Conversation not found');

  return { thread };
}

// Agent processing moved under ConversationOrchestrator.runAgentAssistant

export default function registerConversationsRoutes(
  app: express.Express, 
  repos: LiveRepos,
) {
  // LIST conversations (canonical). Supports optional pagination only; no filters, no sorting.
  // GET /api/conversations?limit=&offset=
  app.get('/api/conversations', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const q = req.query as Record<string, string>;
    // Validate: limit must be integer 1..1000 when provided; offset must be integer >=0 when provided.
    const rawLimit = q.limit;
    const rawOffset = q.offset;
    const hasLimit = typeof rawLimit !== 'undefined';
    const hasOffset = typeof rawOffset !== 'undefined';

    if (hasLimit) {
      if (!/^\d+$/.test(String(rawLimit || ''))) throw new ValidationError('limit must be an integer');
      const n = Number(rawLimit);
      if (!(n >= 1 && n <= 1000)) throw new ValidationError('limit must be between 1 and 1000');
    }
    if (hasOffset) {
      if (!/^\d+$/.test(String(rawOffset || ''))) throw new ValidationError('offset must be a non-negative integer');
      const n = Number(rawOffset);
      if (n < 0) throw new ValidationError('offset must be a non-negative integer');
    }

    const limit = hasLimit ? Number(rawLimit) : 200;
    const offset = hasOffset ? Number(rawOffset) : 0;

    const list = await repos.getConversations(req as any as ReqLike);
    const paged = list.slice(offset, offset + limit);
    return res.json({ total: list.length, items: paged });
  }));

  // ENHANCED: GET /api/conversations/:id/details — conversation + related context
  app.get('/api/conversations/:id/details', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const conversationId = req.params.id;
    const reqLike = req as any as ReqLike;
    const conversation = await repos.getConversationById(reqLike, conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation ${conversationId} not found`);
    }
    const [orchestrationEvents, providerEvents, workspaceItems] = await Promise.all([
      repos.getOrchestrationLogByConversation(reqLike, conversationId),
      repos.getProviderEventsByConversation(reqLike, conversationId),
      repos.getWorkspaceItemsByConversation(reqLike, conversationId),
    ]);
    const metrics = {
      totalTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.totalTokens || 0), 0),
      promptTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.promptTokens || 0), 0),
      completionTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.completionTokens || 0), 0),
      totalLatencyMs: providerEvents.reduce((sum: number, e: any) => sum + (e.latencyMs || 0), 0),
      requestCount: providerEvents.filter((e: any) => e.type === 'request').length,
      errorCount: orchestrationEvents.filter((e: any) => !e.outcome.success).length,
      toolCallCount: conversation.messages.reduce((sum: number, msg: any) => sum + (msg.tool_calls?.length || 0), 0),
    };
    const details = { ...conversation, providerEvents, orchestrationEvents, workspaceItems, metrics };
    res.json(details);
  }));

  // ENHANCED: GET /api/conversations/:id/provider-events — provider events for a conversation
  app.get('/api/conversations/:id/provider-events', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const conversationId = req.params.id;
    const events = await repos.getProviderEventsByConversation(req as any as ReqLike, conversationId);
    res.json(events);
  }));

  // ENHANCED: GET /api/conversations/threads/:id/full — thread with tool-call traces and provider events
  app.get('/api/conversations/threads/:id/full', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const threadId = req.params.id;
    const conversation = await repos.getConversationById(req as any, threadId);
    if (!conversation) {
      throw new NotFoundError(`Thread ${threadId} not found`);
    }
    const threadProviderEvents = await repos.getProviderEventsByConversation(req as any as ReqLike, threadId);
    const toolCalls: Array<{ id: string; name: string; arguments: string; result?: any; error?: string; timestamp?: string; durationMs?: number }> = [];
    conversation.messages.forEach((msg: any) => {
      if (msg.tool_calls) {
        msg.tool_calls.forEach((tc: any) => {
          const resultMsg = conversation.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
          let parsed: any | undefined = undefined;
          let parseError: string | undefined = undefined;
          if (resultMsg && typeof resultMsg.content === 'string' && resultMsg.content.trim()) {
            try { parsed = JSON.parse(resultMsg.content); } catch { parseError = 'invalid_tool_result_json'; }
          }
          const timestamp = (typeof msg?.context?.variables?.timestamp === 'string') ? msg.context.variables.timestamp : undefined;
          toolCalls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments, ...(parsed !== undefined ? { result: parsed } : {}), ...(parseError ? { error: parseError } : {}), ...(timestamp ? { timestamp } : {}) });
        });
      }
    });
    const threadWithContext = { ...conversation, fullMessages: conversation.messages, toolCalls, providerEvents: threadProviderEvents };
    res.json(threadWithContext);
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
    const directorId = String(req.query.directorId ?? '').trim();
    const emailId = String(req.query.emailId ?? '').trim();
    if (!directorId || !emailId) throw new ValidationError('directorId and emailId are required');
    const threads = (await repos.getConversations(req as any as ReqLike)).filter(
      (c) => c.kind === 'director' && c.directorId === directorId && (c.email as any)?.id === emailId
    );
    if (!threads.length) throw new NotFoundError('Conversation not found');
    // Pick the most recent by lastActiveAt (fallback to startedAt)
    const decorated = threads.map((thread) => {
      const lastActiveAt = (thread as any)?.lastActiveAt;
      if (typeof lastActiveAt !== 'string' || !lastActiveAt.trim()) {
        throw new ValidationError(`Conversation ${thread.id} missing lastActiveAt`, 'CONVERSATION_LAST_ACTIVE_MISSING');
      }
      const ts = Date.parse(lastActiveAt);
      if (Number.isNaN(ts)) {
        throw new ValidationError(`Conversation ${thread.id} has invalid lastActiveAt`, 'CONVERSATION_LAST_ACTIVE_INVALID');
      }
      return { thread, ts };
    });
    const thread = decorated.reduce((best, cur) => (cur.ts > best.ts ? cur : best)).thread;
    return res.json(thread);
  }));

  // POST /api/conversations/:id/messages  { content: string }
  app.post('/api/conversations/:id/messages', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const content = String(req.body?.content ?? '');
    if (!content.trim()) throw new ValidationError('Message content is required');
    const conversations = await repos.getConversations(req as any as ReqLike);
    const exists = conversations.some((c) => c.id === id);
    if (!exists) throw new NotFoundError('Conversation not found');
    const msg: PromptMessage = { id: newId(), role: 'user', content };
    await repoAppendMessage(repos, req as any as ReqLike, id, msg);
    logger.info('POST /api/conversations/:id/messages appended user message', { id, length: content.length });
    return res.json({ success: true });
  }));

  // POST /api/conversations/:id/assistant
  app.post('/api/conversations/:id/assistant', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const reqLike = req as any as ReqLike;
    
    const { thread } = await validateConversationRequest(id, reqLike, repos);

    let result: ConversationResult;
    // Use a single orchestrator instance for both branches
    // Always run with a fresh run id for manual steps; accountId must be present on the thread.
    const accountId = (thread as any).accountId as string;
    if (!accountId) throw new ValidationError('accountId missing on conversation thread');
    const runId = newId();
    const orchestrator = new ConversationOrchestrator(reqLike, runId, accountId);
    const userReq = createUserRequest(req as any, repos);
    if (thread.kind === 'director') {
      // Delegate director orchestration to ConversationOrchestrator to ensure contract adherence
      const agents = await repos.getAgents(reqLike);
      const directors = await repos.getDirectors(reqLike);
      const prompts = await repos.getPrompts(reqLike);
      const settings = await repos.getSettings(reqLike);
      const director = directors.find((d: any) => d.id === thread.directorId);
      if (!director) throw new NotFoundError('Director not found for thread');

      const finalThread = await orchestrator.runConversationLoop({
        thread,
        director,
        agents,
        apiConfigs: settings.apiConfigs,
        prompts,
        traceId: (userReq.traceId ?? '') as any
      }, userReq, 6);

      // Determine the last assistant message for response payload
      const lastAssistant = [...finalThread.messages].reverse().find(m => (m as any).role === 'assistant') as PromptMessage | undefined;
      const contentMaybe = (typeof lastAssistant?.content === 'string') ? lastAssistant.content : undefined;
      const toolCallsMaybe = Array.isArray((lastAssistant as any)?.tool_calls) ? (lastAssistant as any).tool_calls : undefined;
      result = {
        assistantMessage: lastAssistant ? lastAssistant : null,
        ...(typeof contentMaybe !== 'undefined' ? { content: contentMaybe } : {}),
        ...(typeof toolCallsMaybe !== 'undefined' ? { toolCalls: toolCallsMaybe } : {}),
      };
    } else {
      // Agent path: delegate to orchestrator to centralize behavior
      const agentOut = await orchestrator.runAgentAssistant(thread, userReq);
      result = {
        assistantMessage: agentOut.assistantMessage,
        ...(typeof agentOut.content !== 'undefined' ? { content: agentOut.content } : {}),
      };
    }

    logger.info('POST /api/conversations/:id/assistant replied', { id, length: String(result.content ?? '').length });
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
