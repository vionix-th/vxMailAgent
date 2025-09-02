import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, requireUid, ReqLike } from '../utils/repo-access';
import type { TemplateItem } from '../../shared/types';

 

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

function loadTemplates(req?: ReqLike): TemplateItem[] {
  try {
    const ureq = requireReq(req);
    let arr = repoGetAll<TemplateItem>(ureq, 'templates');
    if (!Array.isArray(arr)) arr = [];

    // Seed if empty
    if (arr.length === 0) {
      const seeded = seedTemplates();
      repoSetAll<TemplateItem>(ureq, 'templates', seeded);
      logger.info('Seeded prompt templates', { uid: requireUid(ureq) });
      return seeded;
    }

    // Ensure required optimizer exists
    const hasOptimizer = arr.some(t => t.id === 'prompt_optimizer');
    if (!hasOptimizer) {
      const seeded = seedTemplates();
      const next = [seeded[0], ...arr];
      repoSetAll<TemplateItem>(ureq, 'templates', next);
      return next;
    }
    return arr as TemplateItem[];
  } catch (e) {
    logger.warn('Failed to load prompt templates', { err: e });
    // Attempt to recreate with seed to maintain invariant
    try {
      const ureq = requireReq(req);
      const seeded = seedTemplates();
      repoSetAll<TemplateItem>(ureq, 'templates', seeded);
      return seeded;
    } catch {}
    return [];
  }
}

function saveTemplates(req: ReqLike, items: TemplateItem[]) {
  const ureq = requireReq(req);
  repoSetAll<TemplateItem>(ureq, 'templates', items);
}

export default function registerTemplatesRoutes(app: express.Express) {
  // List templates
  app.get('/api/prompt-templates', requireUserContext as any, (req, res) => {
    const ureq = requireReq(req as ReqLike);
    logger.info('GET /api/prompt-templates', { uid: requireUid(ureq) });
    res.json(loadTemplates(ureq));
  });

  // Create
  app.post('/api/prompt-templates', requireUserContext as any, (req, res) => {
    const item: TemplateItem = req.body;
    if (!item || !item.id || !item.name || !Array.isArray(item.messages)) {
      return res.status(400).json({ error: 'Invalid template' });
    }
    const current = loadTemplates(req as ReqLike);
    if (current.some(t => t.id === item.id)) return res.status(400).json({ error: 'Duplicate id' });
    const next = [...current, item];
    saveTemplates(req as ReqLike, next);
    res.json({ success: true });
  });

  // Update
  app.put('/api/prompt-templates/:id', requireUserContext as any, (req, res) => {
    const id = req.params.id;
    const current = loadTemplates(req as ReqLike);
    const idx = current.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    current[idx] = req.body;
    saveTemplates(req as ReqLike, current);
    res.json({ success: true });
  });

  // Delete
  app.delete('/api/prompt-templates/:id', requireUserContext as any, (req, res) => {
    const id = req.params.id;
    if (id === 'prompt_optimizer') {
      return res.status(400).json({ error: 'prompt_optimizer is required and cannot be deleted' });
    }
    const current = loadTemplates(req as ReqLike);
    const next = current.filter(t => t.id !== id);
    saveTemplates(req as ReqLike, next);
    res.json({ success: true });
  });
}

