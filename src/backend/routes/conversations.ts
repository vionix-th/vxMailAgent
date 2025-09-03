import express from 'express';
import { ConversationThread, PromptMessage, ProviderEvent } from '../../shared/types';
import { conversationEngine } from '../services/engine';
import { runAgentConversation } from '../services/orchestration';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { createToolHandler } from '../toolCalls';
import logger from '../services/logger';
import { requireReq, requireRepos } from '../utils/repo-access';
import type { ReqLike } from '../utils/repo-access';
import { LiveRepos } from '../liveRepos';

export default function registerConversationsRoutes(
  app: express.Express, 
  repos: LiveRepos,
  services: {
    logProviderEvent: (e: ProviderEvent, req?: ReqLike) => Promise<void>;
    newId: () => string;
  }
) {
  // LIST conversations (canonical). Supports optional pagination only; no filters, no sorting.
  // GET /api/conversations?limit=&offset=
  app.get('/api/conversations', async (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const list = await repos.getConversations(req as any as ReqLike) || [];
      const limit = Math.max(0, Math.min(1000, Number(q.limit) || 200));
      const offset = Math.max(0, Number(q.offset) || 0);
      const paged = list.slice(offset, offset + limit);
      return res.json({ total: list.length, items: paged });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // GET single conversation by id (canonical)
  app.get('/api/conversations/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const list = await repos.getConversations(req as any as ReqLike);
      const thread = list.find((c) => c.id === id);
      if (!thread) return res.status(404).json({ error: 'Conversation not found' });
      return res.json(thread);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // GET /api/conversations/byDirectorEmail?directorId=...&emailId=...
  app.get('/api/conversations/byDirectorEmail', async (req, res) => {
    const directorId = String(req.query.directorId || '').trim();
    const emailId = String(req.query.emailId || '').trim();
    if (!directorId || !emailId) return res.status(400).json({ error: 'directorId and emailId are required' });
    const threads = (await repos.getConversations(req as any as ReqLike)).filter(
      (c) => c.kind === 'director' && c.directorId === directorId && (c.email as any)?.id === emailId
    );
    if (!threads.length) return res.status(404).json({ error: 'Conversation not found' });
    // Pick the last matching thread in canonical insertion order
    const thread = threads[threads.length - 1];
    return res.json(thread);
  });

  // POST /api/conversations/:id/messages  { content: string }
  app.post('/api/conversations/:id/messages', async (req, res) => {
    const id = req.params.id;
    const content = String(req.body?.content || '');
    if (!content.trim()) return res.status(400).json({ error: 'Message content is required' });
    const conversations = await repos.getConversations(req as any as ReqLike);
    const idx = conversations.findIndex((c) => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
    const t = conversations[idx];
    if ((t as any).status === 'finalized' || t.finalized === true) {
      return res.status(400).json({ error: 'Conversation is finalized' });
    }
    const now = new Date().toISOString();
    const msg: PromptMessage = { role: 'user', content };
    const updated: ConversationThread = {
      ...t,
      messages: [...(t.messages || []), msg],
      lastActiveAt: now,
    };
    const next = conversations.slice();
    next[idx] = updated;
    await repos.setConversations(req as any as ReqLike, next);
    logger.info('POST /api/conversations/:id/messages appended user message', { id, length: content.length });
    return res.json({ success: true });
  });

  // POST /api/conversations/:id/assistant -> trigger assistant response via provider
  app.post('/api/conversations/:id/assistant', async (req, res) => {
    try {
      const id = req.params.id;
      const conversations = await repos.getConversations(req as any as ReqLike);
      const idx = conversations.findIndex((c) => c.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
      const t = conversations[idx];
      if ((t as any).status === 'finalized' || t.finalized === true) {
        return res.status(400).json({ error: 'Conversation is finalized' });
      }

      const api = (await repos.getSettings(requireReq(req as any as ReqLike))).apiConfigs.find((c: any) => c.id === t.apiConfigId);
      if (!api) return res.status(404).json({ error: 'API config not found' });

      // Use existing transcript as-is (OpenAI-aligned)
      const messages = (t.messages || []).map((m) => {
        const base: any = { role: m.role as any, content: (m as any).content ?? null };
        if ((m as any).name) base.name = (m as any).name;
        if (m.role === 'assistant' && (m as any).tool_calls) base.tool_calls = (m as any).tool_calls;
        if (m.role === 'tool' && (m as any).tool_call_id) base.tool_call_id = (m as any).tool_call_id;
        return base;
      });
      // Tool selection is handled by the engine (flags + roleCaps); no local tool building needed.

      // Use unified conversation logic for both director and agent threads
      let lastAssistant: PromptMessage | null = null;
      let lastStep: any = null;
      
      // Get the last user message content for agent conversations
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      const userContent = lastUserMessage?.content || '';
      
      if (t.kind === 'director') {
        // Director threads: single step only (delegations handled by fetcher path)
        const t0 = Date.now();
        let result: any;
        try {
          const engineOut = await conversationEngine.run({
            messages: messages as any,
            apiConfig: api as any,
            role: 'director',
            roleCaps: { canSpawnAgents: true },
            toolRegistry: TOOL_DESCRIPTORS,
            context: { conversationId: id, agents: await repos.getAgents(req as any as ReqLike) || [] },
          });
          result = {
            assistantMessage: engineOut.assistantMessage,
            toolCalls: engineOut.toolCalls,
            content: engineOut.content,
            request: engineOut.request,
            response: engineOut.response,
          } as any;
        } catch (e: any) {
          return res.status(502).json({ error: String(e?.message || e) });
        }
        const latencyMs = Date.now() - t0;
        const now = new Date().toISOString();

        // Append assistant to thread
        const assistant = result.assistantMessage as any as PromptMessage;
        lastAssistant = assistant;
        const updated: ConversationThread = {
          ...t,
          messages: [...(t.messages || []), assistant],
          lastActiveAt: now,
          provider: 'openai',
        } as any;
        {
          const cur = await repos.getConversations(req as any as ReqLike);
          const i2 = cur.findIndex((c) => c.id === id);
          if (i2 !== -1) {
            const next = cur.slice();
            next[i2] = updated;
            await repos.setConversations(req as any as ReqLike, next);
          }
        }
        // Provider events (req-aware)
        try {
          if (result.request) await services.logProviderEvent({ id: services.newId(), conversationId: id, provider: 'openai', type: 'request', timestamp: now, payload: result.request }, req as any as ReqLike);
          const usage = (result.response && (result.response as any).usage) || undefined;
          await services.logProviderEvent({
            id: services.newId(),
            conversationId: id,
            provider: 'openai',
            type: 'response',
            timestamp: now,
            latencyMs,
            usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined,
            payload: result.response,
          }, req as any as ReqLike);
        } catch {}
        lastStep = result;
      } else {
        // Agent threads: use unified agent conversation logic
        try {
          const agentResult = await runAgentConversation(
            t,
            userContent, // Use the user's message content
            await repos.getConversations(req as any as ReqLike),
            api,
            TOOL_DESCRIPTORS,
            async (next: ConversationThread[]) => { await repos.setConversations(req as any as ReqLike, next); },
            createToolHandler(requireRepos(requireReq(req as any as ReqLike))),
            undefined, // No traceId in routes path
            async (ev: ProviderEvent) => { await services.logProviderEvent(ev, req as any as ReqLike); } // Req-aware provider logging
          );
          
          if (agentResult.success) {
            lastAssistant = agentResult.finalAssistantMessage;
            lastStep = { content: agentResult.finalAssistantMessage?.content };
          } else {
            return res.status(502).json({ error: agentResult.error || 'Agent conversation failed' });
          }
        } catch (e: any) {
          return res.status(502).json({ error: String(e?.message || e) });
        }
      }

      logger.info('POST /api/conversations/:id/assistant replied', { id, length: String(lastStep?.content || '').length });
      return res.json({ success: true, message: lastAssistant, content: lastStep?.content, toolCalls: lastStep?.toolCalls });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE single conversation by id
  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const ureq = requireReq(req as any as ReqLike);
      const list = await repos.getConversations(ureq);
      const next = list.filter((c) => c.id !== id);
      const deleted = list.length - next.length;
      if (deleted === 0) return res.status(404).json({ error: 'Conversation not found' });
      await repos.setConversations(ureq, next);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // BULK DELETE conversations by ids array
  app.delete('/api/conversations', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const ureq = requireReq(req as any as ReqLike);
      const list = await repos.getConversations(ureq);
      const set = new Set(ids);
      const next = list.filter((c) => !c.id || !set.has(c.id));
      const deleted = list.length - next.length;
      await repos.setConversations(ureq, next);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
