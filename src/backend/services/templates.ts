import { TemplateItem } from '../../shared/types';
import logger from './logger';
import { requireReq, getTemplatesRepo, ReqLike } from '../utils/repo-access';

export const DEFAULT_OPTIMIZER: TemplateItem = {
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

export async function loadUserTemplates(req?: ReqLike): Promise<TemplateItem[]> {
  try {
    const ureq = requireReq(req);
    const repo = getTemplatesRepo(ureq);
    const arr = await repo.getAll();
    // Producer initializes/ensures optimizer; do not seed here.
    if (!Array.isArray(arr)) return [];
    return arr as TemplateItem[];
  } catch (e) {
    // Strict escalation: propagate repository errors; do not seed on error
    logger.error('loadUserTemplates failed (escalating)', { err: e });
    throw e;
  }
}

/** Partially update a template by id; only name, description, messages are mutable. */
export async function updateTemplatePartial(
  req: ReqLike,
  id: string,
  patch: Partial<Pick<TemplateItem, 'name' | 'description' | 'messages'>>
): Promise<void> {
  const ureq = requireReq(req);
  const repo = getTemplatesRepo(ureq);
  const all = await repo.getAll();
  const idx = all.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Template not found');
  const cur = all[idx];
  const next: TemplateItem = {
    ...cur,
    ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
    ...(typeof patch.description === 'string' || patch.description === undefined ? { description: patch.description } : {}),
    ...(Array.isArray(patch.messages) ? { messages: patch.messages as any } : {}),
  };
  all[idx] = next;
  await repo.setAll(all);
  logger.info('Updated template (partial)', { id });
}
