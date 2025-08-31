import express from 'express';
import { Agent } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
// persistence is handled by injected deps.setAgents

import { UserRequest } from '../middleware/user-context';
import logger from '../services/logger';

export interface AgentsRoutesDeps {
  getAgents: (req?: UserRequest) => Agent[];
  setAgents: (req: UserRequest, next: Agent[]) => void;
}

export default function registerAgentsRoutes(app: express.Express, deps: AgentsRoutesDeps) {
  const sanitizeEnabled = (v: any): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string') continue;
      if ((OPTIONAL_TOOL_NAMES as readonly string[]).includes(x)) { out.push(x); continue; }
    }
    return out.length ? out : [];
  };
  // GET /api/agents
  app.get('/api/agents', (req, res) => {
    logger.info('GET /api/agents');
    res.json(deps.getAgents(req as UserRequest));
  });

  // POST /api/agents
  app.post('/api/agents', (req, res) => {
    const agent: Agent = req.body;
    if (!agent.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Agent' });
    }
    const clean: Agent = { ...agent, enabledToolCalls: sanitizeEnabled((agent as any).enabledToolCalls) };
    const next = [...deps.getAgents(req as UserRequest), clean];
    deps.setAgents(req as UserRequest, next);
    logger.info('POST /api/agents: added agent', { id: agent.id });
    res.json({ success: true });
  });

  // PUT /api/agents/:id
  app.put('/api/agents/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getAgents(req as UserRequest);
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
    deps.setAgents(req as UserRequest, next);
    logger.info('PUT /api/agents/:id updated', { id });
    res.json({ success: true });
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getAgents(req as UserRequest);
    const before = current.length;
    const next = current.filter(a => a.id !== id);
    deps.setAgents(req as UserRequest, next);
    const after = next.length;
    logger.info('DELETE /api/agents/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });
}
