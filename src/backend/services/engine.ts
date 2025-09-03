import { ConversationEngine, ConversationEngineRunInput, ConversationEngineRunResult, ToolDescriptor } from '../../shared/types';
import { chatCompletion } from '../providers/openai';

/** Convert a tool descriptor to the OpenAI tool specification. */
function toOpenAiToolSpec(desc: ToolDescriptor): any {
  return { type: 'function', function: { name: desc.name, description: desc.description, parameters: desc.inputSchema } };
}

/** Filter tool descriptors based on the actor role. */
function filterDescriptorsByRole(descs: ToolDescriptor[], role: 'director' | 'agent'): ToolDescriptor[] {
  return descs.filter((d) => {
    const f = d.flags || {};
    if (f.directorOnly && role !== 'director') return false;
    if (f.mandatory) return true;
    if (f.defaultEnabled) return true;
    return false;
  });
}

/** Conversation engine driving chat completions and tool exposure. */
export const conversationEngine: ConversationEngine = {
  /** Run a single conversation turn. */
  async run(input: ConversationEngineRunInput): Promise<ConversationEngineRunResult> {
    const { messages, apiConfig, role, roleCaps, toolRegistry } = input;
    const enabled = filterDescriptorsByRole(toolRegistry, role);
    let tools: any[] = enabled.map(toOpenAiToolSpec);

    if (role === 'director' && roleCaps?.canSpawnAgents) {
      const agents = Array.isArray((input as any).context?.agents) ? (input as any).context.agents : [];
      if (agents.length) {
        const dynamicAgentTools = agents.map((a: any) => ({
          type: 'function',
          function: {
            name: `agent__${a.id}`,
            description: `Call agent ${a.name || a.id} with input`,
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Instruction for the agent' },
              },
              required: ['input'],
            },
          },
        }));
        tools = [...tools, ...dynamicAgentTools];
      }
    }

    const result = await chatCompletion(apiConfig.apiKey, apiConfig.model, messages as any, {
      tools,
      tool_choice: tools && tools.length ? 'auto' : 'none',
      max_completion_tokens: typeof apiConfig.maxCompletionTokens === 'number' ? apiConfig.maxCompletionTokens : undefined,
    });

    const assistant = result.assistantMessage as any;
    const updatedMessages = [...messages, assistant];
    const usage = (result.response && (result.response as any).usage) || undefined;
    return {
      messages: updatedMessages,
      usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined,
      assistantMessage: assistant,
      content: (assistant && (assistant as any).content) ?? null,
      toolCalls: (result.toolCalls ?? []).map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      request: result.request,
      response: result.response,
    };
  },
};
