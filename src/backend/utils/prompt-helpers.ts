import { ValidationError } from '../services/error-handler';

export type TemplateMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string };
export type ContextPackName = 'affordances' | 'docs-lite' | 'types-lite' | 'routes-lite' | 'examples' | 'policies';
export type TargetSpec = { role: 'director' | 'agent' };

export function clampText(input: string, max: number): string {
  if (!input) return '';
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 3)) + '...';
}

export function parseTarget(payload: any, query: any): TargetSpec {
  const normalize = (value: unknown, label: string): TargetSpec => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(`${label} is required`, 'PROMPT_TARGET_ROLE_REQUIRED');
    }
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'director') return { role: 'director' };
    if (trimmed === 'agent') return { role: 'agent' };
    throw new ValidationError(`${label} must be 'director' or 'agent'`, 'PROMPT_TARGET_ROLE_INVALID');
  };

  if (typeof payload?.target === 'string') {
    return normalize(payload.target, 'payload.target');
  }

  if (payload?.target && typeof payload.target === 'object') {
    return normalize((payload.target as any).role, 'payload.target.role');
  }

  if (typeof query?.target === 'string') {
    return normalize(query.target, 'query.target');
  }

  throw new ValidationError('target.role is required', 'PROMPT_TARGET_ROLE_REQUIRED');
}

export function buildTargetMessage(t: TargetSpec): string {
  if (t.role === 'director') {
    return 'Target: director (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
  }
  return 'Target: agent (system prompt; may include optional follow-up user/assistant messages if strategically useful).';
}

export function parseContextSelection(payload: any, query: any): ContextPackName[] {
  const raw = (payload?.context ?? query?.context ?? '') as any;
  let parts: string[] = [];
  if (Array.isArray(raw)) parts = raw as string[];
  else if (typeof raw === 'string') parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return ['affordances', 'docs-lite', 'types-lite', 'examples', 'routes-lite'];
  const known: ContextPackName[] = ['affordances', 'docs-lite', 'types-lite', 'routes-lite', 'examples', 'policies'];
  return parts.filter(p => (known as string[]).includes(p)) as ContextPackName[];
}

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
