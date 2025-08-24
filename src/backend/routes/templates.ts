import express from 'express';
import fs from 'fs';
import * as persistence from '../persistence';
import { TEMPLATES_FILE } from '../utils/paths';

export interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }>;
}

 

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

function loadTemplates(): TemplateItem[] {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) {
      const seeded = seedTemplates();
      persistence.encryptAndPersist(seeded, TEMPLATES_FILE);
      return seeded;
    }
    const data = persistence.loadAndDecrypt(TEMPLATES_FILE);
    // Only accept canonical array shape; if invalid, reset to seed
    let arr: TemplateItem[] = Array.isArray(data) ? (data as TemplateItem[]) : [];
    if (!Array.isArray(data)) {
      arr = seedTemplates();
      persistence.encryptAndPersist(arr, TEMPLATES_FILE);
    }
    // Ensure required optimizer exists
    const hasOptimizer = arr.some(t => t.id === 'prompt_optimizer');
    if (!hasOptimizer) {
      const seeded = seedTemplates();
      const next = [seeded[0], ...arr];
      persistence.encryptAndPersist(next, TEMPLATES_FILE);
      return next;
    }
    return arr;
  } catch (e) {
    console.error('[WARN] Failed to load prompt templates:', e);
    // Attempt to recreate with seed to maintain invariant
    try {
      const seeded = seedTemplates();
      persistence.encryptAndPersist(seeded, TEMPLATES_FILE);
      return seeded;
    } catch {}
    return [];
  }
}

function saveTemplates(items: TemplateItem[]) {
  persistence.encryptAndPersist(items, TEMPLATES_FILE);
}

export default function registerTemplatesRoutes(app: express.Express) {
  // List templates
  app.get('/api/prompt-templates', (_req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/prompt-templates`);
    res.json(loadTemplates());
  });

  // Create
  app.post('/api/prompt-templates', (req, res) => {
    const item: TemplateItem = req.body;
    if (!item || !item.id || !item.name || !Array.isArray(item.messages)) {
      return res.status(400).json({ error: 'Invalid template' });
    }
    const current = loadTemplates();
    if (current.some(t => t.id === item.id)) return res.status(400).json({ error: 'Duplicate id' });
    const next = [...current, item];
    saveTemplates(next);
    res.json({ success: true });
  });

  // Update
  app.put('/api/prompt-templates/:id', (req, res) => {
    const id = req.params.id;
    const current = loadTemplates();
    const idx = current.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    current[idx] = req.body;
    saveTemplates(current);
    res.json({ success: true });
  });

  // Delete
  app.delete('/api/prompt-templates/:id', (req, res) => {
    const id = req.params.id;
    if (id === 'prompt_optimizer') {
      return res.status(400).json({ error: 'prompt_optimizer is required and cannot be deleted' });
    }
    const current = loadTemplates();
    const next = current.filter(t => t.id !== id);
    saveTemplates(next);
    res.json({ success: true });
  });
}
