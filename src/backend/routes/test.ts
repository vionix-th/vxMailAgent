import express from 'express';
import { Prompt } from '../../shared/types';
import { testOpenAI, testOpenAIConfig } from '../openaiTest';
import { buildOptionalToolSpecs, buildCoreToolSpecs } from '../utils/tools';

export interface TestRoutesDeps {
  getSettings: () => any;
  getPrompts: () => Prompt[];
  getDirectors: () => any[];
  getAgents: () => any[];
}

export default function registerTestRoutes(app: express.Express, deps: TestRoutesDeps) {

  app.get('/api/test/director/:id', async (req, res) => {
    const id = req.params.id;
    const director = deps.getDirectors().find((d: any) => d.id === id);
    if (!director) return res.status(404).json({ error: 'Director not found' });
    const apiConfig = deps.getSettings().apiConfigs.find((c: any) => c.id === director.apiConfigId);
    if (!apiConfig) return res.status(400).json({ error: 'API config not found for director' });
    if (!director.promptId) return res.status(400).json({ error: 'Director has no assigned prompt' });
    const prompt = deps.getPrompts().find(p => p.id === director.promptId);
    if (!prompt) return res.status(400).json({ error: 'Prompt not found for director' });
    const result = await testOpenAI(apiConfig.apiKey, apiConfig.model, prompt.messages, (apiConfig as any)?.maxCompletionTokens);
    res.json(result);
  });

  app.get('/api/test/agent/:id', async (req, res) => {
    const id = req.params.id;
    const agent = deps.getAgents().find((a: any) => a.id === id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const apiConfig = deps.getSettings().apiConfigs.find((c: any) => c.id === agent.apiConfigId);
    if (!apiConfig) return res.status(400).json({ error: 'API config not found for agent' });
    if (!agent.promptId) return res.status(400).json({ error: 'Agent has no assigned prompt' });
    const prompt = deps.getPrompts().find(p => p.id === agent.promptId);
    if (!prompt) return res.status(400).json({ error: 'Prompt not found for agent' });
    const result = await testOpenAI(apiConfig.apiKey, apiConfig.model, prompt.messages, (apiConfig as any)?.maxCompletionTokens);
    res.json(result);
  });

  app.get('/api/test/apiconfig/:id', async (req, res) => {
    const id = req.params.id;
    const apiConfig = deps.getSettings().apiConfigs.find((c: any) => c.id === id);
    if (!apiConfig) return res.status(404).json({ error: 'API config not found' });
    const result = await testOpenAIConfig(apiConfig.apiKey, apiConfig.model, (apiConfig as any)?.maxCompletionTokens);
    res.json(result);
  });

  app.post('/api/test/chat', async (req, res) => {
    try {
      const apiConfigId = String(req.body?.apiConfigId || '');
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const maxCompletionTokens = typeof req.body?.maxCompletionTokens === 'number' ? req.body.maxCompletionTokens : undefined;
      const includeTools = Array.isArray(req.body?.includeTools) ? req.body.includeTools as Array<'calendar_read'|'calendar_add'|'todo_add'|'filesystem_search'|'filesystem_retrieve'|'memory_search'|'memory_add'|'memory_edit'> : [];
      const includeCoreTools = Array.isArray(req.body?.includeCoreTools) ? new Set<string>(req.body.includeCoreTools as string[]) : undefined;
      const toolChoice = req.body?.toolChoice as ('auto'|'none'|{ name: string }|undefined);
      if (!apiConfigId) return res.status(400).json({ error: 'apiConfigId is required' });
      if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages array is required' });
      const apiConfig = deps.getSettings().apiConfigs.find((c: any) => c.id === apiConfigId);
      if (!apiConfig) return res.status(404).json({ error: 'API config not found' });
      const toolsParts: any[] = [];
      if (includeCoreTools) toolsParts.push(...buildCoreToolSpecs(includeCoreTools));
      if (includeTools.length) toolsParts.push(...buildOptionalToolSpecs(new Set(includeTools)));
      const tools = toolsParts.length ? toolsParts : undefined;
      const tc = toolChoice === 'auto' || toolChoice === 'none' ? toolChoice : (toolChoice && typeof toolChoice === 'object' && (toolChoice as any).name ? { type: 'function', function: { name: (toolChoice as any).name } } : undefined);
      const result = await testOpenAI(
        apiConfig.apiKey,
        apiConfig.model,
        messages,
        (typeof maxCompletionTokens === 'number' ? maxCompletionTokens : (apiConfig as any)?.maxCompletionTokens),
        { tools, tool_choice: tc as any }
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
