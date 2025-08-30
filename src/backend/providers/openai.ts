import OpenAI from 'openai';
import { OPENAI_REQUEST_TIMEOUT_MS } from '../config';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ChatCompletionResult {
  content: string;
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
  const openai = new OpenAI({ apiKey });
  const payload: any = {
    model,
    messages: messages as ChatCompletionMessageParam[],
  };
  if (options?.tools) payload.tools = options.tools;
  if (options?.tool_choice) payload.tool_choice = options.tool_choice;
  if (typeof options?.max_completion_tokens === 'number') payload.max_completion_tokens = options.max_completion_tokens;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(1, OPENAI_REQUEST_TIMEOUT_MS || 0));
  try {
    const response = await openai.chat.completions.create(payload, { signal: controller.signal });
    clearTimeout(t);
    const choice = response.choices?.[0];
    const content = choice?.message?.content || '';
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
    if (e?.name === 'AbortError') {
      throw new Error(`openai_request_timeout_${OPENAI_REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  }
}
