import express from 'express';
import { Agent } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
import { UserRequest } from '../middleware/user-context';
import { requireUserContext, validateRequestBody, CommonValidators } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/error-handler';
import { isAgent } from '../utils/type-guards';

export interface AgentsRoutesDeps {
  getAgents: (req?: UserRequest) => Agent[];
  setAgents: (req: UserRequest, next: Agent[]) => void;
}

export default function registerAgentsRoutes(app: express.Express, deps: AgentsRoutesDeps) {
  const sanitizeEnabled = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string') continue;
      if ((OPTIONAL_TOOL_NAMES as readonly string[]).includes(x)) { out.push(x); continue; }
    }
    return out.length ? out : [];
  };
  // GET /api/agents
  app.get('/api/agents', requireUserContext, asyncHandler(async (req: UserRequest, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/agents`);
    const agents = deps.getAgents(req);
    res.json(agents);
  }));

  // POST /api/agents
  app.post('/api/agents', requireUserContext, asyncHandler(async (req: UserRequest, res) => {
    const validation = validateRequestBody<Agent>(
      req,
      CommonValidators.requiredStrings(['apiConfigId']),
      res
    );
    if (!validation.isValid) return;

    const agent = validation.data!;
    if (!isAgent(agent)) {
      throw AppError.validation('Invalid agent data structure');
    }
    const clean: Agent = { ...agent, enabledToolCalls: sanitizeEnabled(agent.enabledToolCalls) };
    const next = [...deps.getAgents(req), clean];
    deps.setAgents(req, next);
    console.log(`[${new Date().toISOString()}] POST /api/agents: added agent ${agent.id}`);
    res.json({ success: true });
  }));

  // PUT /api/agents/:id
  app.put('/api/agents/:id', requireUserContext, asyncHandler(async (req: UserRequest, res) => {
    const id = req.params.id;
    const validation = validateRequestBody<Agent>(
      req,
      CommonValidators.requiredStrings(['apiConfigId']),
      res
    );
    if (!validation.isValid) return;

    const current = deps.getAgents(req);
    const idx = current.findIndex(a => a.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/agents/${id}: not found`);
      throw AppError.notFound(`Agent with id ${id} not found`);
    }

    const agent = validation.data!;
    if (!isAgent(agent)) {
      throw AppError.validation('Invalid agent data structure');
    }
    const clean: Agent = { ...agent, enabledToolCalls: sanitizeEnabled(agent.enabledToolCalls) };
    const next = current.slice();
    next[idx] = clean;
    deps.setAgents(req, next);
    console.log(`[${new Date().toISOString()}] PUT /api/agents/${id}: updated`);
    res.json({ success: true });
  }));

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', requireUserContext, asyncHandler(async (req: UserRequest, res) => {
    const id = req.params.id;
    const current = deps.getAgents(req);
    const before = current.length;
    const next = current.filter(a => a.id !== id);
    
    if (before === next.length) {
      throw AppError.notFound(`Agent with id ${id} not found`);
    }
    
    deps.setAgents(req, next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/agents/${id}: ${before - after} deleted`);
    res.json({ success: true });
  }));
}
