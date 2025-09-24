import express from 'express';
import path from 'path';
import { Prompt } from '../../shared/types';
import { validatePromptTemplate, PromptValidationError } from '../../shared/promptValidation';
import { chatCompletion } from '../providers/openai';

import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError, ConflictError } from '../services/error-handler';
import { buildTargetMessage, parseContextSelection, parseIncluding, parseTarget, TemplateMsg } from '../utils/prompt-helpers';
import { buildSelectedPacks } from '../services/promptContext';
import { loadUserTemplates } from '../services/templates';

export interface PromptsRoutesDeps {
  listPrompts: (req?: ReqLike) => Promise<readonly Prompt[]>;
  getPrompt: (req: ReqLike, id: string) => Promise<Prompt | null>;
  createPrompt: (req: ReqLike, item: Prompt) => Promise<void>;
  updatePrompt: (req: ReqLike, item: Prompt) => Promise<void>;
  deletePrompt: (req: ReqLike, id: string) => Promise<boolean>;
  getSettings: (req?: ReqLike) => Promise<any>;
  getAgents: (req?: ReqLike) => Promise<Array<{ id: string; name: string; promptId?: string; apiConfigId: string }>>;
  getDirectors: (req?: ReqLike) => Promise<Array<{ id: string; name: string; agentIds: string[]; promptId?: string; apiConfigId: string }>>;
}

function ensurePromptPayload(payload: unknown, context: string): Prompt {
  try {
    return validatePromptTemplate(payload, context);
  } catch (error) {
    if (error instanceof PromptValidationError) {
      throw new ValidationError(error.message, 'PROMPT_INVALID');
    }
    throw error;
  }
}

export default function registerPromptsRoutes(app: express.Express, deps: PromptsRoutesDeps) {
  // GET /api/prompts
  app.get('/api/prompts', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.info('GET /api/prompts');
    const list = await deps.listPrompts(req as ReqLike);
    res.json(Array.from(list));
  }));

  // POST /api/prompts
  app.post('/api/prompts', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const prompt = ensurePromptPayload(req.body, 'body');
    const existing = await deps.getPrompt(req as ReqLike, prompt.id);
    if (existing) {
      throw new ConflictError(`Prompt with id '${prompt.id}' already exists`);
    }
    await deps.createPrompt(req as ReqLike, prompt);
    logger.info('POST /api/prompts: added prompt', { id: prompt.id });
    res.json({ success: true });
  }));

  // PUT /api/prompts/:id
  app.put('/api/prompts/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const prompt = ensurePromptPayload(req.body, 'body');
    if (prompt.id !== id) {
      throw new ValidationError('Prompt id mismatch', 'PROMPT_ID_MISMATCH');
    }
    const current = await deps.getPrompt(req as ReqLike, id);
    if (!current) {
      logger.warn('PUT /api/prompts/:id not found', { id });
      throw new NotFoundError('Prompt not found');
    }
    await deps.updatePrompt(req as ReqLike, prompt);
    logger.info('PUT /api/prompts/:id updated', { id });
    res.json({ success: true });
  }));

  // DELETE /api/prompts/:id
  app.delete('/api/prompts/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const removed = await deps.deletePrompt(req as ReqLike, id);
    if (!removed) {
      throw new NotFoundError('Prompt not found');
    }
    logger.info('DELETE /api/prompts/:id deleted', { id, deleted: 1 });
    res.json({ success: true });
  }));

  // POST /api/prompts/assist - optimize a prompt with application context
  app.post('/api/prompts/assist', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const payload = req.body || {};
    const prompt: Prompt | undefined = payload.prompt;
    if (!prompt || !Array.isArray(prompt.messages)) {
      throw new ValidationError('Invalid payload: prompt with messages[] is required');
    }
    const settings = await deps.getSettings(req as ReqLike);
    const api = Array.isArray(settings?.apiConfigs) && settings.apiConfigs[0];
    if (!api) throw new ValidationError('No API configuration available');

    // Always resolve optimizer/system messages from the canonical 'prompt_optimizer' template
    const list = await loadUserTemplates(req as ReqLike);
    const opt = list.find(t => t.id === 'prompt_optimizer');
    if (!opt) {
      throw new NotFoundError('optimizer_template_missing');
    }
    const optimizerMessages: TemplateMsg[] = opt.messages;

    // Build Context Packs with budgets
    const root = path.resolve(__dirname, '../../..');
    const selectedPacks = parseContextSelection(payload, req.query);
    const includingPacks = parseIncluding(payload, req.query);
    const finalPacks = Array.from(new Set<string>([...selectedPacks, ...includingPacks])) as any;
    // Runtime agents/directors (ids/names only), and supported tools/actions
    const agents = (await (deps.getAgents?.(req as ReqLike) || Promise.resolve([]))).map(a => ({ id: a.id, name: a.name }));
    const directors = (await (deps.getDirectors?.(req as ReqLike) || Promise.resolve([]))).map(d => ({ id: d.id, name: d.name, agentIds: d.agentIds }));
    const tools = [
      { kind: 'calendar', actions: ['read', 'add'] },
      { kind: 'todo', actions: ['add'] },
      { kind: 'filesystem', actions: ['search', 'retrieve'] },
      { kind: 'memory', actions: ['search', 'add', 'edit'] },
    ];
    const roleAffordances = {
      roles: {
        director: {
          can: ['orchestrate agents', 'sequence actions', 'invoke tools'],
          tools
        },
        agent: {
          can: ['invoke tools as needed'],
          tools
        }
      }
    };
    const normalizeRole = (value: unknown, label: string): 'director' | 'agent' => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new ValidationError(`${label} is required`, 'PROMPT_TARGET_ROLE_REQUIRED');
      }
      const role = value.trim().toLowerCase();
      if (role !== 'director' && role !== 'agent') {
        throw new ValidationError(`${label} must be 'director' or 'agent'`, 'PROMPT_TARGET_ROLE_INVALID');
      }
      return role as 'director' | 'agent';
    };

    let normalizedRole: 'director' | 'agent' | null = null;
    if (typeof payload?.target === 'string') {
      normalizedRole = normalizeRole(payload.target, 'payload.target');
      payload.target = normalizedRole;
    } else if (payload?.target && typeof payload.target === 'object') {
      const roleValue = (payload.target as any).role;
      normalizedRole = normalizeRole(roleValue, 'payload.target.role');
      (payload.target as any).role = normalizedRole;
    } else if (typeof req.query?.target === 'string') {
      normalizedRole = normalizeRole(req.query.target, 'query.target');
      (req.query as any).target = normalizedRole;
    }

    if (!normalizedRole) {
      throw new ValidationError('target.role is required', 'PROMPT_TARGET_ROLE_REQUIRED');
    }

    const target = parseTarget(payload, req.query);
    // Filter affordances based on target to avoid irrelevant details
    let affordancesObj: any;
    if (target?.role === 'agent') {
      // Provide only agent capabilities
      affordancesObj = { roles: { agent: (roleAffordances as any).roles.agent } };
    } else if (target?.role === 'director') {
      affordancesObj = { agents, directors, roles: roleAffordances.roles };
    }
    const targetMsg = { role: 'user', content: buildTargetMessage(target) } as any;
    const affordances = { role: 'user', content: `Affordances (actor-accessible, authoritative):\n${JSON.stringify(affordancesObj, null, 2)}` } as any;
    // Build selected packs asynchronously (excluding 'affordances' to avoid duplication)
    const merged = await buildSelectedPacks(root, finalPacks);
    const packsLabel = (finalPacks as string[]).filter(p => p !== 'affordances').join(', ');
    const appContext = { role: 'user', content: `Application context (packs: ${packsLabel}):\n${merged}` } as any;
    const current = { role: 'user', content: `Current prompt JSON:\n${JSON.stringify({ id: prompt.id, name: prompt.name, messages: prompt.messages }, null, 2)}` } as any;
    const instruction = { role: 'user', content: 'Rewrite the prompt messages for the specified target, ensuring the first message is a SYSTEM prompt. You MAY optionally include additional USER and/or ASSISTANT messages for strategic priming if they are concise and clearly helpful. Use only relevant and accessible capabilities from the Affordances; do not invent capabilities. For director targets, orchestrate, sequence, and invoke tools as needed. For agent targets, you MAY invoke tools during your turn when necessary and relevant to the objective; keep tool usage minimal and goal-aligned. Prefer structured prompts using Markdown-style headings: Intent, Affordances, IO, Guidelines, Examples. Provide realistic few-shot examples. Do not include markdown code fences. Include infra/meta directives only when they are explicitly actor-accessible and necessary for the task; otherwise omit. Return strict JSON as specified.' } as any;

    const resp = await chatCompletion(api.apiKey, api.model, [...optimizerMessages as any[], targetMsg, affordances, appContext, current, instruction], {
      max_completion_tokens: (typeof (api as any)?.maxCompletionTokens === 'number' ? (api as any).maxCompletionTokens : undefined),
    });
    const text = String((resp as any)?.assistantMessage?.content ?? '').trim();
    let improved: { messages?: Array<{ role: string; content: string }>; notes?: string } = {};
    try { improved = JSON.parse(text); } catch { throw new Error('Assistant returned non-JSON'); }
    if (!improved || !Array.isArray(improved.messages)) throw new Error('Assistant returned invalid JSON');
    const next: Prompt = { ...prompt, messages: improved.messages as any };
    return res.json({ improved: next, notes: improved.notes ?? '' });
  }));
}
