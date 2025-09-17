import { ConversationEngine, ConversationEngineRunInput, ConversationEngineRunResult, ToolDescriptor } from '../../shared/types';
import { chatCompletion } from '../providers/openai';
import { buildToolSpecsByFlags } from '../utils/tools';

/** Conversation engine driving chat completions and tool exposure. */
export const conversationEngine: ConversationEngine = {
  /** Run a single conversation turn. */
  async run(input: ConversationEngineRunInput): Promise<ConversationEngineRunResult> {
    const { messages, apiConfig, role } = input;
    const toOpenAiToolSpec = (desc: ToolDescriptor): any => ({ type: 'function', function: { name: desc.name, description: desc.description, parameters: desc.inputSchema } });
    let tools: any[];
    const provided = (input as any).toolRegistry as ToolDescriptor[] | undefined;
    if (Array.isArray(provided) && provided.length) {
      tools = provided.map(toOpenAiToolSpec);
    } else {
      tools = buildToolSpecsByFlags(role);
    }

    // Dynamic per-agent tools are deprecated; use delegate_to_agent only

    const completionOpts: any = {
      tools,
      tool_choice: tools && tools.length ? 'auto' : 'none',
      ...(typeof apiConfig.maxCompletionTokens === 'number' ? { max_completion_tokens: apiConfig.maxCompletionTokens } : {}),
    };
    const result = await chatCompletion(apiConfig.apiKey, apiConfig.model, messages as any, completionOpts);

    const assistant = result.assistantMessage as any;
    const updatedMessages = [...messages, assistant];
    const usage = (result.response && (result.response as any).usage) || undefined;
    const out: ConversationEngineRunResult = {
      messages: updatedMessages,
      assistantMessage: assistant,
      content: (assistant && (assistant as any).content) ?? null,
      request: result.request,
      response: result.response,
    };
    if (Array.isArray(result.toolCalls)) {
      (out as any).toolCalls = result.toolCalls.map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
    }
    if (usage) {
      (out as any).usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens };
    }
    return out;
  },
};
