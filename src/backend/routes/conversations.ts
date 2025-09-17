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
    const directorId = String(req.query.directorId ?? '').trim();
    const emailId = String(req.query.emailId ?? '').trim();
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
        assistantMessage: lastAssistant || null,
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
