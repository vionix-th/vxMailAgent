import express from 'express';
import path from 'path';
import fs from 'fs';
import { Prompt } from '../../shared/types';
import * as persistence from '../persistence';
import { chatCompletion } from '../providers/openai';

import { UserRequest } from '../middleware/user-context';

export interface PromptsRoutesDeps {
  getPrompts: (req?: UserRequest) => Prompt[];
  setPrompts: (req: UserRequest, next: Prompt[]) => void;
  getSettings: () => any;
  getAgents: (req?: UserRequest) => Array<{ id: string; name: string; promptId?: string; apiConfigId: string }>;
  getDirectors: (req?: UserRequest) => Array<{ id: string; name: string; agentIds: string[]; promptId?: string; apiConfigId: string }>;
}

 

type TemplateMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string };
type TemplateItem = { id: string; name: string; description?: string; messages: TemplateMsg[] };

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

function loadTemplatesArray(): TemplateItem[] {
  try {
    const templatesFile = 'templates.json'; // Global fallback storage for templates
    if (!fs.existsSync(templatesFile)) {
      const seeded = DEFAULT_OPTIMIZER ? [DEFAULT_OPTIMIZER] : [];
      persistence.encryptAndPersist(seeded, templatesFile);
    }
    const raw = persistence.loadAndDecrypt(templatesFile);
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
      const arr: TemplateItem[] = Object.values(raw as any);
      // Ensure optimizer presence and canonical content
      let next = arr;
      if (!arr.some(t => t.id === 'prompt_optimizer')) {
        next = [DEFAULT_OPTIMIZER, ...arr];
      } else {
        next = arr.map(t => t.id === 'prompt_optimizer' ? { ...t, name: DEFAULT_OPTIMIZER.name, messages: DEFAULT_OPTIMIZER.messages } : t);
      }
      const templatesFile = 'templates.json';
      persistence.encryptAndPersist(next, templatesFile);
      return next;
    }
    const arr = Array.isArray(raw) ? (raw as TemplateItem[]) : [];
    let next = arr;
    if (!arr.some(t => t.id === 'prompt_optimizer')) {
      next = [DEFAULT_OPTIMIZER, ...arr];
    } else {
      next = arr.map(t => t.id === 'prompt_optimizer' ? { ...t, name: DEFAULT_OPTIMIZER.name, messages: DEFAULT_OPTIMIZER.messages } : t);
    }
    const templatesFile3 = 'templates.json';
    persistence.encryptAndPersist(next, templatesFile3);
    return next;
  } catch (e) {
    console.warn('[WARN] loadTemplatesArray failed:', e);
    // Recreate with optimizer to maintain invariant
    try {
      const seeded = [DEFAULT_OPTIMIZER];
      const templatesFile4 = 'templates.json';
      persistence.encryptAndPersist(seeded, templatesFile4);
      return seeded;
    } catch {}
    return [DEFAULT_OPTIMIZER];
  }
}

export default function registerPromptsRoutes(app: express.Express, deps: PromptsRoutesDeps) {
  // GET /api/prompts
  app.get('/api/prompts', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/prompts`);
    res.json(deps.getPrompts(req as UserRequest));
  });

  // POST /api/prompts
  app.post('/api/prompts', (req, res) => {
    const prompt: Prompt = req.body;
    const next = [...deps.getPrompts(req as UserRequest), prompt];
    deps.setPrompts(req as UserRequest, next);
    console.log(`[${new Date().toISOString()}] POST /api/prompts: added prompt ${prompt.id}`);
    res.json({ success: true });
  });

  // PUT /api/prompts/:id
  app.put('/api/prompts/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getPrompts(req as UserRequest);
    const idx = current.findIndex(p => p.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/prompts/${id}: not found`);
      return res.status(404).json({ error: 'Prompt not found' });
    }
    const next = current.slice();
    next[idx] = req.body;
    deps.setPrompts(req as UserRequest, next);
    console.log(`[${new Date().toISOString()}] PUT /api/prompts/${id}: updated`);
    res.json({ success: true });
  });

  // DELETE /api/prompts/:id
  app.delete('/api/prompts/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getPrompts(req as UserRequest);
    const before = current.length;
    const next = current.filter(p => p.id !== id);
    deps.setPrompts(req as UserRequest, next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/prompts/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });

  // POST /api/prompts/assist - optimize a prompt with application context
  app.post('/api/prompts/assist', async (req, res) => {
    try {
      const payload = req.body || {};
      const prompt: Prompt | undefined = payload.prompt;
      if (!prompt || !Array.isArray(prompt.messages)) {
        return res.status(400).json({ error: 'Invalid payload: prompt with messages[] is required' });
      }
      const settings = deps.getSettings();
      const api = Array.isArray(settings?.apiConfigs) && settings.apiConfigs[0];
      if (!api) return res.status(400).json({ error: 'No API configuration available' });

      // Always resolve optimizer/system messages from the canonical 'prompt_optimizer' template
      const list = loadTemplatesArray();
      const opt = list.find(t => t.id === 'prompt_optimizer');
      if (!opt) {
        return res.status(500).json({ error: 'optimizer_template_missing' });
      }
      const optimizerMessages: TemplateMsg[] = opt.messages;

      // Build Context Packs with budgets
      const root = path.resolve(__dirname, '../../..');
      const selectedPacks = parseContextSelection(payload, req.query);
      const includingPacks = parseIncluding(payload, req.query);
      const finalPacks = Array.from(new Set<ContextPackName>([...selectedPacks, ...includingPacks])) as ContextPackName[];
      // Runtime agents/directors (ids/names only), and supported tools/actions
      const agents = (deps.getAgents?.(req as UserRequest) || []).map(a => ({ id: a.id, name: a.name }));
      const directors = (deps.getDirectors?.(req as UserRequest) || []).map(d => ({ id: d.id, name: d.name, agentIds: d.agentIds }));
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
        return res.status(400).json({ error: 'target_required', allowed: ['director', 'agent'] });
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
      try { improved = JSON.parse(text); } catch { return res.status(502).json({ error: 'Assistant returned non-JSON', raw: text }); }
      if (!improved || !Array.isArray(improved.messages)) return res.status(502).json({ error: 'Assistant returned invalid JSON', raw: improved });
      const next: Prompt = { ...prompt, messages: improved.messages as any };
      return res.json({ improved: next, notes: improved.notes || '' });
    } catch (e: any) {
      console.error('[ERROR] /api/prompts/assist failed:', e);
      return res.status(500).json({ error: 'assist_failed', detail: String(e?.message || e) });
    }
  });
}
