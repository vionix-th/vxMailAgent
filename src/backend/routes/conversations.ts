import express from 'express';
import { createCleanupService, RepositoryHub } from '../services/cleanup';
import { ConversationThread, PromptMessage, ProviderEvent, Director, Agent } from '../../shared/types';
import { conversationEngine } from '../services/engine';
import { TOOL_DESCRIPTORS } from '../../shared/tools';

export interface ConversationsRoutesDeps {
  getConversations: () => ConversationThread[];
  setConversations: (next: ConversationThread[]) => void;
  getSettings: () => any;
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
    const now = new Date().toISOString();
    const msg: PromptMessage = { role: 'user', content };
    const updated: ConversationThread = {
      ...t,
      messages: [...(t.messages || []), msg],
      lastActiveAt: now,
    };
    const next = conversations.slice();
    next[idx] = updated;
    deps.setConversations(next);
    console.log(`[${now}] POST /api/conversations/${id}/messages -> appended user message (${content.length} chars)`);
    return res.json({ success: true });
  });

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

      const api = deps.getSettings().apiConfigs.find((c: any) => c.id === t.apiConfigId);
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
            context: { conversationId: id, agents: deps.getAgents() || [] },
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
        lastStep = result;
      } else {
        // Agent threads: use unified agent conversation logic
        try {
          const { runAgentConversation } = require('../services/orchestration');
          
          const agentResult = await runAgentConversation(
            t,
            userContent, // Use the user's message content
            deps.getConversations(),
            api,
            TOOL_DESCRIPTORS,
            deps.setConversations,
            undefined, // No traceId in routes path
            deps.logProviderEvent // Add provider event logging
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

      console.log(`[${new Date().toISOString()}] POST /api/conversations/${id}/assistant -> assistant replied (${String(lastStep?.content || '').length} chars)`);
      return res.json({ success: true, message: lastAssistant, content: lastStep?.content, toolCalls: lastStep?.toolCalls });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

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
