import express from 'express';
import { createCleanupService, RepositoryHub } from '../services/cleanup';
import { ConversationThread, PromptMessage, ProviderEvent, Director, Agent } from '../../shared/types';
import { conversationEngine } from '../services/engine';
import { TOOL_DESCRIPTORS } from '../../shared/tools';
import { handleToolByName } from '../toolCalls';

export interface ConversationsRoutesDeps {
  getConversations: () => ConversationThread[];
  setConversations: (next: ConversationThread[]) => void;
  getSettings: () => any;
  calcExpiresFrom: (nowIso: string) => string;
  isExpired: (thread: ConversationThread) => boolean;
  isDirectorFinalized: (dirId: string) => boolean;
  logProviderEvent: (ev: ProviderEvent) => void;
  newId: () => string;
  getDirectors: () => Director[];
  getAgents: () => Agent[];
}

export default function registerConversationsRoutes(app: express.Express, deps: ConversationsRoutesDeps) {
  const hub: RepositoryHub = {
    getFetcherLog: () => [],
    setFetcherLog: () => {},
    getOrchestrationLog: () => [],
    setOrchestrationLog: () => {},
    getConversations: () => deps.getConversations() as any[],
    setConversations: (next: any[]) => deps.setConversations(next as any),
    getProviderEvents: () => [],
    setProviderEvents: () => {},
    getTraces: () => [],
    setTraces: () => {},
  };
  const cleanup = createCleanupService(hub);
  // LIST conversations (canonical). Supports optional pagination only; no filters, no sorting.
  // GET /api/conversations?limit=&offset=
  app.get('/api/conversations', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const list = deps.getConversations() || [];
      const limit = Math.max(0, Math.min(1000, Number(q.limit) || 200));
      const offset = Math.max(0, Number(q.offset) || 0);
      const paged = list.slice(offset, offset + limit);
      return res.json({ total: list.length, items: paged });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // GET single conversation by id (canonical)
  app.get('/api/conversations/:id', (req, res) => {
    try {
      const id = req.params.id;
      const thread = deps.getConversations().find((c) => c.id === id);
      if (!thread) return res.status(404).json({ error: 'Conversation not found' });
      return res.json(thread);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // GET /api/conversations/byDirectorEmail?directorId=...&emailId=...
  app.get('/api/conversations/byDirectorEmail', (req, res) => {
    const directorId = String(req.query.directorId || '').trim();
    const emailId = String(req.query.emailId || '').trim();
    if (!directorId || !emailId) return res.status(400).json({ error: 'directorId and emailId are required' });
    const threads = deps.getConversations().filter(
      (c) => c.kind === 'director' && c.directorId === directorId && (c.email as any)?.id === emailId
    );
    if (!threads.length) return res.status(404).json({ error: 'Conversation not found' });
    // Pick the last matching thread in canonical insertion order
    const thread = threads[threads.length - 1];
    return res.json(thread);
  });

  // POST /api/conversations/:id/messages  { content: string }
  app.post('/api/conversations/:id/messages', (req, res) => {
    const id = req.params.id;
    const content = String(req.body?.content || '');
    if (!content.trim()) return res.status(400).json({ error: 'Message content is required' });
    const conversations = deps.getConversations();
    const idx = conversations.findIndex((c) => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
    const t = conversations[idx];
    if (deps.isDirectorFinalized(t.directorId) || (t as any).status === 'finalized' || t.finalized === true) {
      return res.status(400).json({ error: 'Conversation is finalized' });
    }
    if (deps.isExpired(t)) {
      return res.status(400).json({ error: 'Conversation expired' });
    }
    const now = new Date().toISOString();
    const msg: PromptMessage = { role: 'user', content };
    const updated: ConversationThread = {
      ...t,
      messages: [...(t.messages || []), msg],
      lastActiveAt: now,
      expiresAt: deps.calcExpiresFrom(now),
    };
    const next = conversations.slice();
    next[idx] = updated;
    deps.setConversations(next);
    console.log(`[${now}] POST /api/conversations/${id}/messages -> appended user message (${content.length} chars)`);
    return res.json({ success: true });
  });

  // POST /api/conversations/:id/assistant -> trigger assistant response via provider
  app.post('/api/conversations/:id/assistant', async (req, res) => {
    try {
      const id = req.params.id;
      const conversations = deps.getConversations();
      const idx = conversations.findIndex((c) => c.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
      const t = conversations[idx];
      if (deps.isDirectorFinalized(t.directorId) || (t as any).status === 'finalized' || t.finalized === true) {
        return res.status(400).json({ error: 'Conversation is finalized' });
      }
      if (deps.isExpired(t)) {
        return res.status(400).json({ error: 'Conversation expired' });
      }
      const settings = deps.getSettings();
      const api = Array.isArray(settings?.apiConfigs) && settings.apiConfigs.find((c: any) => c.id === t.apiConfigId);
      if (!api) return res.status(400).json({ error: 'API config not found for conversation' });

      // Use existing transcript as-is (OpenAI-aligned)
      const messages = (t.messages || []).map((m) => {
        const base: any = { role: m.role as any, content: (m as any).content ?? null };
        if ((m as any).name) base.name = (m as any).name;
        if (m.role === 'assistant' && (m as any).tool_calls) base.tool_calls = (m as any).tool_calls;
        if (m.role === 'tool' && (m as any).tool_call_id) base.tool_call_id = (m as any).tool_call_id;
        return base;
      });
      // Tool selection is handled by the engine (flags + roleCaps); no local tool building needed.

      // For agent threads, run a small tool-call loop so results are produced, mirroring fetcher behavior
      const LOOP_MAX = 6;
      let stepCount = 0;
      let currentMessages: any[] = [...messages];
      let lastStep: any = null;
      let lastAssistant: PromptMessage | null = null;
      while (true) {
        stepCount++;
        const t0 = Date.now();
        let result: any;
        try {
          // Prefer unified engine path
          const engineOut = await conversationEngine.run({
            messages: currentMessages as any,
            apiConfig: api as any,
            role: t.kind,
            roleCaps: { canSpawnAgents: t.kind === 'director' },
            toolRegistry: TOOL_DESCRIPTORS,
            context: t.kind === 'director'
              ? { conversationId: id, agents: deps.getAgents() || [] }
              : { conversationId: id },
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
          ...((stepCount === 1) ? t : deps.getConversations()[deps.getConversations().findIndex((c) => c.id === id)]),
          messages: [...(((stepCount === 1) ? t : deps.getConversations()[deps.getConversations().findIndex((c) => c.id === id)]).messages || []), assistant],
          lastActiveAt: now,
          expiresAt: deps.calcExpiresFrom(now),
          provider: 'openai',
        } as any;
        {
          const cur = deps.getConversations();
          const i2 = cur.findIndex((c) => c.id === id);
          if (i2 !== -1) {
            const next = cur.slice();
            next[i2] = updated;
            deps.setConversations(next);
          }
        }
        // Provider events
        try {
          if (result.request) deps.logProviderEvent({ id: deps.newId(), conversationId: id, provider: 'openai', type: 'request', timestamp: now, payload: result.request });
          const usage = (result.response && (result.response as any).usage) || undefined;
          deps.logProviderEvent({
            id: deps.newId(),
            conversationId: id,
            provider: 'openai',
            type: 'response',
            timestamp: now,
            latencyMs,
            usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined,
            payload: result.response,
          });
        } catch {}

        currentMessages = [...currentMessages, assistant as any];
        lastStep = result;

        // Director threads: single step only (delegations handled by fetcher path)
        if (t.kind === 'director') break;

        // Agent threads: execute tools until none or LOOP_MAX reached
        if (!result.toolCalls || result.toolCalls.length === 0) break;
        if (stepCount >= LOOP_MAX) break;

        for (const tc of result.toolCalls) {
          let args: any = {};
          try { args = tc.arguments ? JSON.parse(tc.arguments) : {}; }
          catch { args = {}; }
          const exec = await handleToolByName(tc.name, args);
          const toolMsg: any = { role: 'tool', name: tc.name, tool_call_id: tc.id, content: JSON.stringify(exec) };
          currentMessages.push(toolMsg);
          // Append tool message to thread
          const cur = deps.getConversations();
          const i2 = cur.findIndex((c) => c.id === id);
          if (i2 !== -1) {
            const now2 = new Date().toISOString();
            const updated2: ConversationThread = {
              ...cur[i2],
              messages: [...(cur[i2].messages || []), toolMsg],
              lastActiveAt: now2,
              expiresAt: deps.calcExpiresFrom(now2),
            } as any;
            const next = cur.slice();
            next[i2] = updated2;
            deps.setConversations(next);
          }
        }
        // loop continues for next assistant step
      }

      console.log(`[${new Date().toISOString()}] POST /api/conversations/${id}/assistant -> assistant replied (${String(lastStep?.content || '').length} chars)`);
      return res.json({ success: true, message: lastAssistant, content: lastStep?.content, toolCalls: lastStep?.toolCalls });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE single conversation by id (delegates to cleanup service)
  app.delete('/api/conversations/:id', (req, res) => {
    try {
      const id = req.params.id;
      const { deleted } = cleanup.removeConversationsByIds([id]);
      if (deleted === 0) return res.status(404).json({ error: 'Conversation not found' });
      return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // BULK DELETE conversations by ids array (delegates to cleanup service)
  app.delete('/api/conversations', (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const { deleted } = cleanup.removeConversationsByIds(ids);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
