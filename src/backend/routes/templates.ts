import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, requireUid, ReqLike } from '../utils/repo-access';
import type { TemplateItem } from '../../shared/types';
import { errorHandler, ValidationError } from '../services/error-handler';
import { updateTemplatePartial } from '../services/templates';

 

function seedTemplates(): TemplateItem[] {
  return [
    {
      id: 'prompt_optimizer',
      name: 'Prompt Optimizer (System)',
      description: 'System preface for the Prompt Assistant; can be used or customized when optimizing prompts.',
      messages: [
        {
          role: 'system',
          content:
            'You are a prompt optimization assistant for an email-oriented AI orchestration system.\n' +
            '- Strictly maintain role separation between director and agent prompts.\n' +
            '- Focus on workspace/output-oriented deliverables with clear result contracts.\n' +
            '- Prefer structured prompts and few-shot examples; avoid invented tools or infrastructure.\n' +
            '- Output only JSON of the shape { "messages": [{ "role": "system|user|assistant", "content": "..." }], "notes": "..." }. No extra prose.'
        }
      ]
    }
  ];
}

async function loadTemplates(req?: ReqLike): Promise<TemplateItem[]> {
  try {
    const ureq = requireReq(req);
    let arr = await repoGetAll<TemplateItem>(ureq, 'templates');
    if (!Array.isArray(arr)) arr = [];

    // Seed if empty
    if (arr.length === 0) {
      const seeded = seedTemplates();
      await repoSetAll<TemplateItem>(ureq, 'templates', seeded);
      logger.info('Seeded prompt templates', { uid: requireUid(ureq) });
      return seeded;
    }

    // Ensure required optimizer exists
    const hasOptimizer = arr.some(t => t.id === 'prompt_optimizer');
    if (!hasOptimizer) {
      const seeded = seedTemplates();
      const next = [seeded[0], ...arr];
      await repoSetAll<TemplateItem>(ureq, 'templates', next);
      return next;
    }
    return arr as TemplateItem[];
  } catch (e) {
    // Strict escalation: propagate repository errors; do not seed on error
    logger.error('Failed to load prompt templates (escalating)', { err: e });
    throw e;
  }
}

async function saveTemplates(req: ReqLike, items: TemplateItem[]) {
  const ureq = requireReq(req);
  await repoSetAll<TemplateItem>(ureq, 'templates', items);
}

export default function registerTemplatesRoutes(app: express.Express) {
  // List templates
  app.get('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    logger.info('GET /api/prompt-templates', { uid: requireUid(ureq) });
    res.json(await loadTemplates(ureq));
  }));

  // Create
  app.post('/api/prompt-templates', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const item: TemplateItem = req.body;
    if (!item || !item.id || !item.name || !Array.isArray(item.messages)) {
      throw new ValidationError('Invalid template');
    }
    const current = await loadTemplates(req as ReqLike);
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
    const current = await loadTemplates(req as ReqLike);
    const next = current.filter(t => t.id !== id);
    await saveTemplates(req as ReqLike, next);
    res.json({ success: true });
  }));
}
