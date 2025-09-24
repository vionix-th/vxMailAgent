import { PromptMessage } from '../../shared/types';
import { newId } from './id';
import { ValidationError } from '../services/error-handler';

/**
 * Transform conversation messages for engine consumption.
 * Extracts and normalizes message properties for API compatibility.
 */
export function transformMessagesForEngine(messages: any[]): any[] {
  return messages.map((m) => {
    const base: any = { role: m.role as any, content: (m as any).content ?? null };
    if ((m as any).name) base.name = (m as any).name;
    if (m.role === 'assistant' && (m as any).tool_calls) base.tool_calls = (m as any).tool_calls;
    if (m.role === 'tool' && (m as any).tool_call_id) base.tool_call_id = (m as any).tool_call_id;
    return base;
  });
}

/**
 * Create a standardized tool response message.
 */
export function createToolResponseMessage(
  toolCallId: string,
  content: string | object
): PromptMessage {
  return {
    id: newId(),
    role: 'tool',
    tool_call_id: toolCallId,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  };
}

/**
 * Create a standardized error message for tool calls.
 */
export function createToolErrorMessage(
  toolCallId: string,
  error: string
): PromptMessage {
  return {
    id: newId(),
    role: 'tool',
    tool_call_id: toolCallId,
    content: `Error: ${error}`
  };
}

/**
 * Create a standardized result message for tool calls.
 */
export function createToolResultMessage(toolCallId: string, result: any): PromptMessage {
  return {
    id: newId(),
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(result)
  };
}

/**
 * Extract the last user message content from a conversation.
 */
export function extractLastUserContent(messages: any[]): string {
  if (!Array.isArray(messages)) {
    throw new ValidationError('agent conversation messages must be an array', 'AGENT_MESSAGES_INVALID');
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate && candidate.role === 'user') {
      const content = (candidate as any).content;
      if (typeof content === 'string' && content.trim().length > 0) {
        return content;
      }
      break;
    }
  }
  throw new ValidationError('agent conversation missing user message content', 'AGENT_USER_MESSAGE_MISSING');
}

/**
 * Validate that a message has required properties for its role.
 */
export function validateMessage(message: any): boolean {
  if (!message.role) return false;
  
  switch (message.role) {
    case 'tool':
      return !!(message.tool_call_id && message.content);
    case 'assistant':
      return !!(message.content || message.tool_calls);
    case 'user':
    case 'system':
      return !!message.content;
    default:
      return false;
  }
}
