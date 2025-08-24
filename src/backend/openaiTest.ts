import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export async function testOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | null; name?: string; tool_call_id?: string; tool_calls?: any }>,
  maxCompletionTokens?: number,
  options?: { tools?: any[]; tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } } }
) {
  const openai = new OpenAI({ apiKey });
  try {
    const payload: any = {
      model,
      messages: messages.map((m) => {
        const base: any = { role: m.role, content: (m as any).content ?? '' };
        if ((m as any).name) base.name = (m as any).name;
        if (m.role === 'assistant' && (m as any).tool_calls) base.tool_calls = (m as any).tool_calls;
        if (m.role === 'tool' && (m as any).tool_call_id) base.tool_call_id = (m as any).tool_call_id;
        return base;
      }) as ChatCompletionMessageParam[],
    };
    if (typeof maxCompletionTokens === 'number') payload.max_completion_tokens = maxCompletionTokens;
    if (options?.tools) payload.tools = options.tools;
    if (options?.tool_choice) payload.tool_choice = options.tool_choice;
    const response = await openai.chat.completions.create(payload);
    return { success: true, response, request: payload };
  } catch (error: any) {
    return { success: false, error: error.response?.data || error.message || String(error) };
  }
}

export async function testOpenAIConfig(apiKey: string, model: string, maxCompletionTokens?: number) {
  return testOpenAI(apiKey, model, [
    { role: 'system', content: 'You are a test agent.' },
    { role: 'user', content: 'Say hello.' }
  ], maxCompletionTokens);
}
