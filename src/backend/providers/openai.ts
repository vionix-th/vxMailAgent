import OpenAI from 'openai';
import { OPENAI_REQUEST_TIMEOUT_MS } from '../config';
import logger from '../services/logger';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ChatCompletionResult {
  content: string | null;
  request: Record<string, any>;
  response: any;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  assistantMessage: ChatCompletionMessageParam;
}

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  options?: { tools?: any[]; tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }; max_completion_tokens?: number }
): Promise<ChatCompletionResult> {
  const useStub = String(process.env.VX_TEST_OPENAI_STUB || '').toLowerCase() === 'true';
  const forcedError = String(process.env.VX_TEST_FORCE_OPENAI_ERROR || '').toLowerCase();
  const payload: any = {
    model,
    messages: messages as ChatCompletionMessageParam[],
  };
  if (options?.tools) payload.tools = options.tools;
  if (options?.tool_choice) payload.tool_choice = options.tool_choice;
  if (typeof options?.max_completion_tokens === 'number') payload.max_completion_tokens = options.max_completion_tokens;
  const controller = new AbortController();
  const timeoutMs = Math.max(1, OPENAI_REQUEST_TIMEOUT_MS || 0);
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (useStub) {
      const includeTools = Array.isArray((options as any)?.tools) ? (options as any).tools : [];
      const toolNames = includeTools
        .map((tool: any) => (tool && typeof tool === 'object' ? tool.function?.name : undefined))
        .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0);
      if (toolNames.length) {
        logger.debug('[OPENAI_STUB] tools detected', { tools: toolNames });
      }
      if (forcedError === 'timeout' || forcedError === 'abort') {
        const abortErr: any = new Error('Request was aborted.');
        abortErr.name = forcedError === 'timeout' ? 'AbortError' : 'Error';
        throw abortErr;
      }
      if (forcedError === 'error') {
        throw new Error('Forced OpenAI error');
      }
      const supportsWorkspace = includeTools.some((tool: any) => {
        const name = tool && typeof tool === 'object' ? tool.function?.name : undefined;
        return typeof name === 'string' && name === 'workspace_add_item';
      });
      const agentId = process.env.VX_TEST_WORKSPACE_AGENT_ID || 'int-workspace-agent';
      if (supportsWorkspace || String(process.env.VX_TEST_FORCE_WORKSPACE_TOOLCALL || '').toLowerCase() === 'true') {
        const tc = {
          id: 'tc_workspace_add_item',
          type: 'function',
          function: {
            name: 'workspace_add_item',
            arguments: JSON.stringify({
              agent_id: agentId,
              mimeType: 'text/plain',
              encoding: 'utf8',
              data: 'hello from stub',
              label: 'stub-note',
              tags: ['stub'],
            }),
          },
        } as any;
        const assistantMessage: ChatCompletionMessageParam = {
          role: 'assistant',
          content: null as any,
          tool_calls: [tc],
        } as any;
        clearTimeout(t);
        return {
          content: null,
          request: { provider: 'openai', endpoint: 'chat.completions', model, messages, tools: includeTools },
          response: { id: 'stubbed', choices: [{ message: assistantMessage }] },
          toolCalls: [{ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }],
          assistantMessage,
        };
      }
      const assistantMessage: ChatCompletionMessageParam = { role: 'assistant', content: 'stubbed-response' } as any;
      clearTimeout(t);
      return { content: 'stubbed-response', request: { provider: 'openai', endpoint: 'chat.completions', model, messages }, response: { id: 'stubbed', choices: [{ message: assistantMessage }] }, toolCalls: undefined, assistantMessage };
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create(payload, { signal: controller.signal });
    clearTimeout(t);
    const choice = response.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
    const toolCalls = (choice?.message as any)?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments,
    })) || undefined;
    const request = { ...payload, provider: 'openai', endpoint: 'chat.completions' };
    const assistantMessage: ChatCompletionMessageParam = {
      role: 'assistant',
      // if no content, set to null to satisfy schema when tool_calls exist
      content: (choice?.message?.content ?? null) as any,
      ...(choice && (choice.message as any)?.tool_calls ? { tool_calls: (choice.message as any).tool_calls } : {}),
    } as any;
    return { content, request, response, toolCalls, assistantMessage };
  } catch (e: any) {
    clearTimeout(t);
    const name = typeof e?.name === 'string' ? e.name : '';
    const message = typeof e?.message === 'string' ? e.message : '';
    const isAbort = name === 'AbortError' || /request was aborted/i.test(message);
    if (isAbort) {
      const normalized = new Error(`openai_request_timeout_${OPENAI_REQUEST_TIMEOUT_MS}ms`);
      (normalized as any).name = 'OpenAIRequestTimeoutError';
      (normalized as any).cause = e;
      throw normalized;
    }
    throw e;
  }
}
