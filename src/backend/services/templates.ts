import { TemplateItem } from '../../shared/types';
import logger from './logger';
import { requireContext, getTemplatesRepo, ContextInput } from '../utils/repo-access';

export async function loadUserTemplates(req?: ContextInput): Promise<TemplateItem[]> {
  try {
    const ureq = requireContext(req);
    const repo = getTemplatesRepo(ureq);
    const arr = await repo.list();
    // Producer initializes/ensures optimizer; do not seed here.
    return Array.from(arr) as TemplateItem[];
  } catch (e) {
    // Strict escalation: propagate repository errors; do not seed on error
    logger.error('loadUserTemplates failed (escalating)', { err: e });
    throw e;
  }
}

/** Partially update a template by id; only name, description, messages are mutable. */
export async function updateTemplatePartial(
  req: ContextInput,
  id: string,
  patch: Partial<Pick<TemplateItem, 'name' | 'description' | 'messages'>>
): Promise<void> {
  const ureq = requireContext(req);
  const repo = getTemplatesRepo(ureq);
  const current = await repo.getById(id);
  if (!current) throw new Error('Template not found');
  const next: TemplateItem = {
    ...current,
    ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
    ...(typeof patch.description === 'string' || patch.description === undefined ? { description: patch.description } : {}),
    ...(Array.isArray(patch.messages) ? { messages: patch.messages as any } : {}),
  };
  await repo.update(next);
  logger.info('Updated template (partial)', { id });
}
