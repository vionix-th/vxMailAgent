import express from 'express';
import path from 'path';
import fs from 'fs';
import { Prompt } from '../../shared/types';
import { chatCompletion } from '../providers/openai';

import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { requireReq, requireUid, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import type { TemplateItem } from '../../shared/types';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

export interface PromptsRoutesDeps {
  getPrompts: (req?: ReqLike) => Promise<Prompt[]>;
  setPrompts: (req: ReqLike, next: Prompt[]) => Promise<void>;
  getSettings: (req?: ReqLike) => Promise<any>;
  getAgents: (req?: ReqLike) => Promise<Array<{ id: string; name: string; promptId?: string; apiConfigId: string }>>;
  getDirectors: (req?: ReqLike) => Promise<Array<{ id: string; name: string; agentIds: string[]; promptId?: string; apiConfigId: string }>>;
}

 

type TemplateMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string };

type ContextPackName = 'affordances' | 'docs-lite' | 'types-lite' | 'routes-lite' | 'examples' | 'policies';

function clampText(input: string, max: number): string {
  if (!input) return '';
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 3)) + '...';
}

type TargetSpec = { role: 'director' | 'agent' };

function parseTarget(payload: any, query: any): TargetSpec | null {
  const raw = (payload?.target ?? query?.target ?? '').toString().trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'director') return { role: 'director' };
  if (raw === 'agent') return { role: 'agent' };
  // Object form fallback
  if (typeof payload?.target === 'object' && payload.target) {
    const r = String(payload.target.role || '').toLowerCase();
    if (r === 'director') return { role: 'director' };
    if (r === 'agent') return { role: 'agent' };
  }
  return null;
}

function buildTargetMessage(t: TargetSpec | null): string {
  if (!t) return 'Target: unspecified (optimizer must infer role and keep instructions role-appropriate).';
  if (t.role === 'director') return 'Target: director (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
  return 'Target: agent (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
}

function parseContextSelection(payload: any, query: any): ContextPackName[] {
  const raw = (payload?.context ?? query?.context ?? '') as any;
  let parts: string[] = [];
  if (Array.isArray(raw)) parts = raw as string[];
  else if (typeof raw === 'string') parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  // Default selection includes routes-lite per Caesar's directive
  if (parts.length === 0) return ['affordances', 'docs-lite', 'types-lite', 'examples', 'routes-lite'];
  // Validate against known names
  const known: ContextPackName[] = ['affordances', 'docs-lite', 'types-lite', 'routes-lite', 'examples', 'policies'];
  return parts.filter(p => (known as string[]).includes(p)) as ContextPackName[];
}

// Optionally include additional packs via an 'including' parameter.
// Accepts:
//  - 'optional' => adds lighter extras (examples, policies)
//  - 'all' => adds all known packs
//  - comma-separated string or array of explicit pack names
function parseIncluding(payload: any, query: any): ContextPackName[] {
  const raw = (payload?.including ?? query?.including ?? '') as any;
  if (!raw) return [];
  const known: ContextPackName[] = ['affordances', 'docs-lite', 'types-lite', 'routes-lite', 'examples', 'policies'];
  const toList = (val: any): string[] => {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };
  const lower = (v: string) => v.toLowerCase();
  if (typeof raw === 'string') {
    const v = lower(raw);
    if (v === 'optional') return ['examples', 'policies'];
    if (v === 'all') return known.slice();
  }
  const parts = toList(raw).map(lower);
  return (parts.filter(p => (known as string[]).includes(p)) as ContextPackName[]);
}

function buildDocsLite(root: string): string {
  const tryRead = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const design = tryRead(path.join(root, 'DESIGN.md')) || tryRead(path.join(root, 'Design.md'));
  const example = tryRead(path.join(root, 'Example.md'));
  const devDoc = tryRead(path.join(root, 'docs', 'DEVELOPER.md'));
  const troubleshooting = tryRead(path.join(root, 'docs', 'TROUBLESHOOTING.md'));
  const sections: string[] = [];
  if (design) sections.push('=== DESIGN.md (excerpt) ===', clampText(design, 4000));
  if (example) sections.push('=== Example.md (excerpt) ===', clampText(example, 2500));
  if (devDoc) sections.push('=== docs/DEVELOPER.md (excerpt) ===', clampText(devDoc, 2000));
  if (troubleshooting) sections.push('=== docs/TROUBLESHOOTING.md (excerpt) ===', clampText(troubleshooting, 1500));
  return sections.join('\n\n');
}

function buildTypesLite(root: string): string {
  const tryRead = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const types = tryRead(path.join(root, 'src', 'shared', 'types.ts'));
  if (!types) return '';
  // Naive extraction: keep exported interfaces/enums/types headers and first few lines
  const lines = types.split('\n');
  const picked: string[] = [];
  for (let i = 0; i < lines.length && picked.join('\n').length < 1800; i++) {
    const l = lines[i];
    if (/^export\s+(interface|type|enum)\s+/.test(l)) {
      picked.push(l);
      // include up to next closing brace or 10 lines
      let braceDepth = l.includes('{') ? 1 : 0;
      let j = i + 1;
      let count = 0;
      while (j < lines.length && count < 20 && (braceDepth > 0 || !/;\s*$/.test(lines[j-1] || ''))) {
        const lj = lines[j];
        if (lj.includes('{')) braceDepth++;
        if (lj.includes('}')) braceDepth = Math.max(0, braceDepth - 1);
        picked.push(lj);
        j++; count++;
        if (braceDepth === 0 && /}\s*;?\s*$/.test(lj)) break;
      }
      i = j - 1;
      picked.push('');
    }
  }
  return ['=== Shared Types (selected exports) ===', clampText(picked.join('\n'), 2000)].filter(Boolean).join('\n');
}

function buildRoutesLite(root: string): string {
  const routesDir = path.join(root, 'src', 'backend', 'routes');
  let entries: Array<{ method: string; path: string; file: string }> = [];
  try {
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));
    for (const f of files) {
      const full = path.join(routesDir, f);
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch { text = ''; }
      if (!text) continue;
      const regex = /app\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text))) {
        entries.push({ method: m[1].toUpperCase(), path: m[2], file: f });
      }
    }
  } catch {}
  entries = entries.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 80);
  const lines = entries.map(e => `${e.method} ${e.path} (${e.file})`);
  return ['=== Backend Routes (lite) ===', clampText(lines.join('\n'), 1500)].filter(Boolean).join('\n');
}

function buildExamples(root: string): string {
  const dir = path.join(root, 'data', 'prompt-examples');
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return '';
  } catch { return ''; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.txt')).slice(0, 8);
  const chunks: string[] = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { text = ''; }
    if (text) chunks.push(`=== Example: ${f} ===\n` + clampText(text.trim(), 1200));
  }
  return chunks.join('\n\n');
}

function buildPolicies(): string {
  const bullets = [
    '- Actor-actionable only; use capabilities actually accessible to the actor.',
    '- No invented tools/APIs; Affordances are authoritative.',
    '- Keep prompts lean; avoid boilerplate disclaimers.',
    '- Use Markdown-style sections; no code fences.',
    '- Infra/meta only if actor-accessible and necessary.',
  ];
  return ['=== Prompt Policies ===', bullets.join('\n')].join('\n');
}

const DEFAULT_OPTIMIZER: TemplateItem = {
  id: 'prompt_optimizer',
  name: 'Prompt Optimizer (System)',
  messages: [
    {
      role: 'system',
      content:
        'You are a prompt optimization assistant for an email-oriented AI orchestration system.\n' +
        '- Strictly maintain role separation between director and agent prompts.\n' +
        '- Only include actor-actionable guidance: instructions the target actor can perform through its interfaces and responsibilities.\n' +
        '- Use only capabilities that are relevant and accessible to the actor. Derive these from the Affordances section when provided. Do not invent capabilities that are not listed.\n' +
        '- Infrastructure/meta directives are permitted only if they are explicitly actor-accessible and required for the task; otherwise omit them.\n' +
        '- Produce structured prompts using compact, human-readable sections with Markdown-style headings (no code fences).\n' +
        '  Sections to use when applicable: \n' +
        '  ## Intent\n' +
        '  ## Affordances (only capabilities from provided Affordances; no invented ones)\n' +
        '  ## IO (inputs/outputs in actor-actionable terms; no UI/frontend/transport details)\n' +
        '  ## Guidelines (concise directives the actor can execute)\n' +
        '  ## Examples (few-shot: realistic <input>/<output> pairs)\n' +
        '  Do NOT include markdown code fences. Keep it concise and readable.\n' +
        '- Prefer structured prompts and few-shot examples; avoid invented tools, APIs, or infrastructure.\n' +
        '- Keep prompts lean: avoid boilerplate disclaimers and non-essential notes.\n' +
        '- Output only JSON of the shape { "messages": [{ "role": "system|user|assistant", "content": "..." }], "notes": "..." }. No extra prose.'
    }
  ]
};

async function loadUserTemplates(req?: ReqLike): Promise<TemplateItem[]> {
  try {
    const ureq = requireReq(req);
    let arr = await repoGetAll<TemplateItem>(ureq, 'templates');
    if (!Array.isArray(arr)) arr = [];
    // Seed optimizer if missing/empty
    if (arr.length === 0) {
      const seeded = [DEFAULT_OPTIMIZER];
      await repoSetAll<TemplateItem>(ureq, 'templates', seeded);
      logger.info('Seeded templates with optimizer', { uid: requireUid(ureq) });
      return seeded;
    }
    if (!arr.some(t => t.id === 'prompt_optimizer')) {
      const next = [DEFAULT_OPTIMIZER, ...arr];
      await repoSetAll<TemplateItem>(ureq, 'templates', next);
      return next;
    }
    // Ensure canonical optimizer content
    const next = arr.map(t => t.id === 'prompt_optimizer' ? { ...t, name: DEFAULT_OPTIMIZER.name, messages: DEFAULT_OPTIMIZER.messages } : t);
    if (JSON.stringify(next) !== JSON.stringify(arr)) {
      await repoSetAll<TemplateItem>(ureq, 'templates', next);
    }
    return next as TemplateItem[];
  } catch (e) {
    logger.warn('loadUserTemplates failed', { err: e });
    try {
      const ureq = requireReq(req);
      const seeded = [DEFAULT_OPTIMIZER];
      await repoSetAll<TemplateItem>(ureq, 'templates', seeded);
      return seeded;
    } catch {}
    return [DEFAULT_OPTIMIZER];
  }
}

export default function registerPromptsRoutes(app: express.Express, deps: PromptsRoutesDeps) {
  // GET /api/prompts
  app.get('/api/prompts', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.info('GET /api/prompts');
    res.json(await deps.getPrompts(req as ReqLike));
  }));

  // POST /api/prompts
  app.post('/api/prompts', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const prompt: Prompt = req.body;
    const current = await deps.getPrompts(req as ReqLike);
    const next = [...current, prompt];
    await deps.setPrompts(req as ReqLike, next);
    logger.info('POST /api/prompts: added prompt', { id: prompt.id });
    res.json({ success: true });
  }));

  // PUT /api/prompts/:id
  app.put('/api/prompts/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const current = await deps.getPrompts(req as ReqLike);
    const idx = current.findIndex(p => p.id === id);
    if (idx === -1) {
      logger.warn('PUT /api/prompts/:id not found', { id });
      throw new NotFoundError('Prompt not found');
    }
    const next = current.slice();
    next[idx] = req.body;
    await deps.setPrompts(req as ReqLike, next);
    logger.info('PUT /api/prompts/:id updated', { id });
    res.json({ success: true });
  }));

  // DELETE /api/prompts/:id
  app.delete('/api/prompts/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const current = await deps.getPrompts(req as ReqLike);
    const before = current.length;
    const next = current.filter(p => p.id !== id);
    await deps.setPrompts(req as ReqLike, next);
    const after = next.length;
    logger.info('DELETE /api/prompts/:id deleted', { id, deleted: before - after });
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
    const finalPacks = Array.from(new Set<ContextPackName>([...selectedPacks, ...includingPacks])) as ContextPackName[];
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
    const target = parseTarget(payload, req.query);
    if (!target) {
      throw new ValidationError('target_required');
    }
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
    // Build selected packs (excluding 'affordances' here to avoid duplication)
    const packOutputs: string[] = [];
    const include = (name: ContextPackName, builder: () => string) => {
      if (finalPacks.includes(name)) {
        const out = builder();
        if (out) packOutputs.push(out);
      }
    };
    include('docs-lite', () => buildDocsLite(root));
    include('types-lite', () => buildTypesLite(root));
    include('routes-lite', () => buildRoutesLite(root));
    include('examples', () => buildExamples(root));
    include('policies', () => buildPolicies());
    // Global cap to prevent bloat
    let merged = packOutputs.join('\n\n');
    const GLOBAL_CAP = 9000;
    if (merged.length > GLOBAL_CAP) merged = clampText(merged, GLOBAL_CAP);
    const packsLabel = finalPacks.filter(p => p !== 'affordances').join(', ');
    const appContext = { role: 'user', content: `Application context (packs: ${packsLabel}):\n${merged}` } as any;
    const current = { role: 'user', content: `Current prompt JSON:\n${JSON.stringify({ id: prompt.id, name: prompt.name, messages: prompt.messages }, null, 2)}` } as any;
    const instruction = { role: 'user', content: 'Rewrite the prompt messages for the specified target, ensuring the first message is a SYSTEM prompt. You MAY optionally include additional USER and/or ASSISTANT messages for strategic priming if they are concise and clearly helpful. Use only relevant and accessible capabilities from the Affordances; do not invent capabilities. For director targets, orchestrate, sequence, and invoke tools as needed. For agent targets, you MAY invoke tools during your turn when necessary and relevant to the objective; keep tool usage minimal and goal-aligned. Prefer structured prompts using Markdown-style headings: Intent, Affordances, IO, Guidelines, Examples. Provide realistic few-shot examples. Do not include markdown code fences. Include infra/meta directives only when they are explicitly actor-accessible and necessary for the task; otherwise omit. Return strict JSON as specified.' } as any;

    const resp = await chatCompletion(api.apiKey, api.model, [...optimizerMessages as any[], targetMsg, affordances, appContext, current, instruction], {
      max_completion_tokens: (typeof (api as any)?.maxCompletionTokens === 'number' ? (api as any).maxCompletionTokens : undefined),
    });
    const text = String((resp as any)?.assistantMessage?.content || '').trim();
    let improved: { messages?: Array<{ role: string; content: string }>; notes?: string } = {};
    try { improved = JSON.parse(text); } catch { throw new Error('Assistant returned non-JSON'); }
    if (!improved || !Array.isArray(improved.messages)) throw new Error('Assistant returned invalid JSON');
    const next: Prompt = { ...prompt, messages: improved.messages as any };
    return res.json({ improved: next, notes: improved.notes || '' });
  }));
}
