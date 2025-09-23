export type TemplateMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string };
export type ContextPackName = 'affordances' | 'docs-lite' | 'types-lite' | 'routes-lite' | 'examples' | 'policies';
export type TargetSpec = { role: 'director' | 'agent' };

export function clampText(input: string, max: number): string {
  if (!input) return '';
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 3)) + '...';
}

export function parseTarget(payload: any, query: any): TargetSpec | null {
  const normalize = (value: unknown): TargetSpec | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'director') return { role: 'director' };
    if (trimmed === 'agent') return { role: 'agent' };
    return null;
  };

  if (typeof payload?.target === 'string') {
    const spec = normalize(payload.target);
    if (spec) return spec;
  }

  if (payload?.target && typeof payload.target === 'object') {
    const role = (payload.target as any).role;
    const spec = normalize(typeof role === 'string' ? role : undefined);
    if (spec) return spec;
  }

  if (typeof query?.target === 'string') {
    return normalize(query.target);
  }

  return null;
}

export function buildTargetMessage(t: TargetSpec | null): string {
  if (!t) return 'Target: unspecified (optimizer must infer role and keep instructions role-appropriate).';
  if (t.role === 'director') return 'Target: director (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
  return 'Target: agent (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
}

export function parseContextSelection(payload: any, query: any): ContextPackName[] {
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
export function parseIncluding(payload: any, query: any): ContextPackName[] {
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
