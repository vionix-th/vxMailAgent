import express from 'express';
import { Prompt } from '../../shared/types';
import { chatCompletion } from '../providers/openai';
import { buildOptionalToolSpecs, buildCoreToolSpecs } from '../utils/tools';
import { requireUserContext } from '../middleware/user-context';
import { requireReq, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import { loadSettings } from '../services/settings';

export interface TestRoutesDeps {
  getPrompts: (req?: ReqLike) => Promise<Prompt[]>;
  getDirectors: (req?: ReqLike) => Promise<any[]>;
  getAgents: (req?: ReqLike) => Promise<any[]>;
}

async function runTestChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | null; name?: string; tool_call_id?: string; tool_calls?: any }> ,
  options?: { tools?: any[]; tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }; max_completion_tokens?: number }
): Promise<{ success: boolean; response?: any; request?: any; assistantMessage?: any; toolCalls?: any; error?: any }> {
  try {
    const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!trimmedKey) {
      return { success: false, error: 'Missing API key' };
    }
    const result = await chatCompletion(trimmedKey, model, messages as any, options);
    return {
      success: true,
      response: result.response,
      request: result.request,
      assistantMessage: result.assistantMessage,
      toolCalls: result.toolCalls,
    };
  } catch (error: any) {
    const detail = error?.response?.data || error?.message || String(error);
    return { success: false, error: detail };
  }
}

export default function registerTestRoutes(app: express.Express, deps: TestRoutesDeps) {

  // /api/test/director/:id
  app.get('/api/test/director/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const director = (await deps.getDirectors(req as ReqLike)).find((d: any) => d.id === id);
    if (!director) throw new NotFoundError('Director not found');
    const settings = await loadSettings(requireReq(req as ReqLike));
    const apiConfig = settings.apiConfigs.find((c: any) => c.id === director.apiConfigId) as any;
    if (!apiConfig) throw new NotFoundError('API config not found for director');
    if (!director.promptId) throw new ValidationError('Director has no assigned prompt');
    const prompt = (await deps.getPrompts(req as ReqLike)).find(p => p.id === director.promptId);
    if (!prompt) throw new NotFoundError('Prompt not found for director');
    const maxTokens = typeof (apiConfig as any)?.maxCompletionTokens === 'number' ? (apiConfig as any).maxCompletionTokens : undefined;
    const result = await runTestChat(apiConfig.apiKey, apiConfig.model, prompt.messages as any, maxTokens ? { max_completion_tokens: maxTokens } : undefined);
    res.json(result);
  }));

  // /api/test/agent/:id
  app.get('/api/test/agent/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const agent = (await deps.getAgents(req as ReqLike)).find((a: any) => a.id === id);
    if (!agent) throw new NotFoundError('Agent not found');
    const settings = await loadSettings(requireReq(req as ReqLike));
    const apiConfig = settings.apiConfigs.find((c: any) => c.id === agent.apiConfigId) as any;
    if (!apiConfig) throw new NotFoundError('API config not found for agent');
    if (!agent.promptId) throw new ValidationError('Agent has no assigned prompt');
    const prompt = (await deps.getPrompts(req as ReqLike)).find(p => p.id === agent.promptId);
    if (!prompt) throw new NotFoundError('Prompt not found for agent');
    const maxTokens = typeof (apiConfig as any)?.maxCompletionTokens === 'number' ? (apiConfig as any).maxCompletionTokens : undefined;
    const result = await runTestChat(apiConfig.apiKey, apiConfig.model, prompt.messages as any, maxTokens ? { max_completion_tokens: maxTokens } : undefined);
    res.json(result);
  }));

  // /api/test/apiconfig/:id
  app.get('/api/test/apiconfig/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const settings = await loadSettings(requireReq(req as ReqLike));
    const apiConfig = settings.apiConfigs.find((c: any) => c.id === id) as any;
    if (!apiConfig) throw new NotFoundError('API config not found');
    const maxTokens = typeof (apiConfig as any)?.maxCompletionTokens === 'number' ? (apiConfig as any).maxCompletionTokens : undefined;
    const result = await runTestChat(
      apiConfig.apiKey,
      apiConfig.model,
      [
        { role: 'system', content: 'You are a test agent.' },
        { role: 'user', content: 'Say hello.' }
      ],
      maxTokens ? { max_completion_tokens: maxTokens } : undefined
    );
    res.json(result);
  }));

  // POST /api/test/chat — playground endpoint to chat with an ApiConfig using arbitrary messages
  app.post('/api/test/chat', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const apiConfigId = String(req.body?.apiConfigId ?? '');
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const maxCompletionTokens = typeof req.body?.maxCompletionTokens === 'number' ? req.body.maxCompletionTokens : undefined;
    const includeTools = Array.isArray(req.body?.includeTools) ? req.body.includeTools as Array<'calendar_read'|'calendar_add'|'todo_add'|'filesystem_search'|'filesystem_retrieve'|'memory_search'|'memory_add'|'memory_edit'> : [];
    const includeCoreTools = Array.isArray(req.body?.includeCoreTools) ? new Set<string>(req.body.includeCoreTools as string[]) : undefined;
    const toolChoice = req.body?.toolChoice as ('auto'|'none'|{ name: string }|undefined);
    if (!apiConfigId) throw new ValidationError('apiConfigId is required');
    if (!Array.isArray(messages) || messages.length === 0) throw new ValidationError('messages array is required');
    const settings = await loadSettings(requireReq(req as ReqLike));
    const apiConfig = settings.apiConfigs.find((c: any) => c.id === apiConfigId) as any;
    if (!apiConfig) throw new NotFoundError('API config not found');
    const toolsParts: any[] = [];
    if (includeCoreTools) toolsParts.push(...buildCoreToolSpecs(includeCoreTools));
    if (includeTools.length) toolsParts.push(...buildOptionalToolSpecs(new Set(includeTools)));
    const tools = toolsParts.length ? toolsParts : undefined;
    const tc = toolChoice === 'auto' || toolChoice === 'none' ? toolChoice : (toolChoice && typeof toolChoice === 'object' && (toolChoice as any).name ? { type: 'function', function: { name: (toolChoice as any).name } } : undefined);
    const maxTokens = typeof maxCompletionTokens === 'number'
      ? maxCompletionTokens
      : (typeof (apiConfig as any)?.maxCompletionTokens === 'number' ? (apiConfig as any).maxCompletionTokens : undefined);
    const result = await runTestChat(
      apiConfig.apiKey,
      apiConfig.model,
      messages,
      {
        ...(tools ? { tools } : {}),
        ...(tc ? { tool_choice: tc as any } : {}),
        ...(typeof maxTokens === 'number' ? { max_completion_tokens: maxTokens } : {}),
      }
    );
    res.json(result);
  }));
}
