import express from 'express';
import { Agent } from '../../shared/types';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';
// persistence is handled by injected deps.setAgents

import { ReqLike } from '../utils/repo-access';
import logger from '../services/logger';

export interface AgentsRoutesDeps {
  getAgents: (req?: ReqLike) => Promise<Agent[]>;
  setAgents: (req: ReqLike, next: Agent[]) => Promise<void> | void;
}

export default function registerAgentsRoutes(app: express.Express, deps: AgentsRoutesDeps) {
  // GET /api/agents
  app.get('/api/agents', async (req, res) => {
    logger.info('GET /api/agents');
    res.json(await deps.getAgents(req as ReqLike));
  });

  // POST /api/agents
  app.post('/api/agents', async (req, res) => {
    const agent: Agent = req.body;
    if (!agent.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Agent' });
    }
    const clean: Agent = { ...agent, enabledToolCalls: sanitizeEnabled((agent as any).enabledToolCalls) };
    const current = await deps.getAgents(req as ReqLike);
    const next = [...current, clean];
    await deps.setAgents(req as ReqLike, next);
    logger.info('POST /api/agents: added agent', { id: agent.id });
    res.json({ success: true });
  });

  // PUT /api/agents/:id
  app.put('/api/agents/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getAgents(req as ReqLike);
    const idx = current.findIndex(a => a.id === id);
    if (idx === -1) {
      logger.warn('PUT /api/agents/:id not found', { id });
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (!req.body.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Agent' });
    }
    const clean: Agent = { ...req.body, enabledToolCalls: sanitizeEnabled((req.body as any).enabledToolCalls) };
    const next = current.slice();
    next[idx] = clean;
    await deps.setAgents(req as ReqLike, next);
    logger.info('PUT /api/agents/:id updated', { id });
    res.json({ success: true });
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getAgents(req as ReqLike);
    const before = current.length;
    const next = current.filter(a => a.id !== id);
    await deps.setAgents(req as ReqLike, next);
    const after = next.length;
    logger.info('DELETE /api/agents/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });
}
