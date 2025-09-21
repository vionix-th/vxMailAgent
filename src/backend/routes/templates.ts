import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { requireReq, repoSetAll, requireUid, ReqLike } from '../utils/repo-access';
import type { TemplateItem } from '../../shared/types';
import { errorHandler, ValidationError } from '../services/error-handler';
import { updateTemplatePartial, loadUserTemplates } from '../services/templates';

 

// No seeding here; producer initializes in repository/registry.ts

async function saveTemplates(req: ReqLike, items: TemplateItem[]) {
  const ureq = requireReq(req);
  await repoSetAll<TemplateItem>(ureq, 'templates', items);
}

export default function registerTemplatesRoutes(app: express.Express) {
  // List templates
  app.get('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    logger.info('GET /api/prompt-templates', { uid: requireUid(ureq) });
    res.json(await loadUserTemplates(ureq));
  }));

  // Create
  app.post('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const item: TemplateItem = req.body;
    if (!item || !item.id || !item.name || !Array.isArray(item.messages)) {
      throw new ValidationError('Invalid template');
    }
    const current = await loadUserTemplates(req as ReqLike);
    if (current.some(t => t.id === item.id)) throw new ValidationError('Duplicate id');
    const next = [...current, item];
    await saveTemplates(req as ReqLike, next);
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
    await updateTemplatePartial(req as ReqLike, id, allowed as any);
    res.json({ success: true });
  }));

  // Delete
  app.delete('/api/prompt-templates/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    if (id === 'prompt_optimizer') {
      throw new ValidationError('prompt_optimizer is required and cannot be deleted');
    }
    const current = await loadUserTemplates(req as ReqLike);
    const next = current.filter(t => t.id !== id);
    await saveTemplates(req as ReqLike, next);
    res.json({ success: true });
  }));
}
