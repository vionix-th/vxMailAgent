import express from 'express';
import { Agent } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
// persistence is handled by injected deps.setAgents

export interface AgentsRoutesDeps {
  getAgents: () => Agent[];
  setAgents: (next: Agent[]) => void;
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
  app.get('/api/agents', (_req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/agents`);
    res.json(deps.getAgents());
  });

  // POST /api/agents
  app.post('/api/agents', (req, res) => {
    const agent: Agent = req.body;
    if (!agent.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Agent' });
    }
    const clean: Agent = { ...agent, enabledToolCalls: sanitizeEnabled((agent as any).enabledToolCalls) };
    const next = [...deps.getAgents(), clean];
    deps.setAgents(next);
    console.log(`[${new Date().toISOString()}] POST /api/agents: added agent ${agent.id}`);
    res.json({ success: true });
  });

  // PUT /api/agents/:id
  app.put('/api/agents/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getAgents();
    const idx = current.findIndex(a => a.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/agents/${id}: not found`);
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (!req.body.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Agent' });
    }
    const next = current.slice();
    next[idx] = { ...(req.body as Agent), enabledToolCalls: sanitizeEnabled((req.body as any).enabledToolCalls) } as Agent;
    deps.setAgents(next);
    console.log(`[${new Date().toISOString()}] PUT /api/agents/${id}: updated`);
    res.json({ success: true });
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getAgents();
    const before = current.length;
    const next = current.filter(a => a.id !== id);
    deps.setAgents(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/agents/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });
}
