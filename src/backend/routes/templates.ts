import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { requireContext, getTemplatesRepo, requireUid } from '../utils/repo-access';
import type { TemplateItem } from '../../shared/types';
import { errorHandler, ValidationError } from '../services/error-handler';
import { updateTemplatePartial, loadUserTemplates } from '../services/templates';

export default function registerTemplatesRoutes(app: express.Express) {
  // List templates
  app.get('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const context = requireContext(req);
    logger.info('GET /api/prompt-templates', { uid: requireUid(context) });
    res.json(await loadUserTemplates(context));
  }));

  // Create
  app.post('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const item: TemplateItem = req.body;
    if (!item || !item.id || !item.name || !Array.isArray(item.messages)) {
      throw new ValidationError('Invalid template');
    }
    const repo = getTemplatesRepo(requireContext(req));
    const existing = await repo.getById(item.id);
    if (existing) throw new ValidationError('Duplicate id');
    await repo.insert(item);
    res.json({ success: true });
  }));

  // Update (partial)
  app.put('/api/prompt-templates/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const patch = req.body as Partial<TemplateItem>;
    // Only allow name, description, messages
    const allowed: Partial<TemplateItem> = {};
    if (typeof patch.name === 'string') (allowed as any).name = patch.name;
    if (typeof patch.description === 'string' || patch.description === undefined) (allowed as any).description = patch.description as any;
    if (Array.isArray(patch.messages)) (allowed as any).messages = patch.messages as any;
    await updateTemplatePartial(requireContext(req), id, allowed as any);
    res.json({ success: true });
  }));

  // Delete
  app.delete('/api/prompt-templates/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    if (id === 'prompt_optimizer') {
      throw new ValidationError('prompt_optimizer is required and cannot be deleted');
    }
    const repo = getTemplatesRepo(requireContext(req));
    const removed = await repo.delete(id);
    if (!removed) {
      throw new ValidationError('Template not found');
    }
    res.json({ success: true });
  }));
}
