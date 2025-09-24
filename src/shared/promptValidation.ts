import type { Prompt, PromptMessage } from './types';

const ALLOWED_ROLES: ReadonlySet<PromptMessage['role']> = new Set(['system', 'user', 'assistant', 'tool']);

export class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptValidationError';
  }
}

export function validatePromptTemplate(input: unknown, context: string = 'prompt'): Prompt {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    throw new PromptValidationError(`${context} must be an object`);
  }
  const payload = input as Record<string, unknown>;
  const idRaw = payload.id;
  const id = typeof idRaw === 'string' ? idRaw.trim() : '';
  if (!id) {
    errors.push(`${context}.id is required`);
  }
  const nameRaw = payload.name;
  const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  if (!name) {
    errors.push(`${context}.name is required`);
  }
  const messagesRaw = payload.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    errors.push(`${context}.messages must be a non-empty array`);
  }
  const sanitizedMessages: PromptMessage[] = [];
  if (Array.isArray(messagesRaw)) {
    messagesRaw.forEach((msg, index) => {
      if (!msg || typeof msg !== 'object') {
        errors.push(`${context}.messages[${index}] must be an object`);
        return;
      }
      const record = msg as Record<string, unknown>;
      const roleRaw = record.role;
      if (typeof roleRaw !== 'string') {
        errors.push(`${context}.messages[${index}].role is required`);
        return;
      }
      const role = roleRaw.trim().toLowerCase();
      if (!ALLOWED_ROLES.has(role as PromptMessage['role'])) {
        errors.push(`${context}.messages[${index}].role must be one of system|user|assistant|tool`);
        return;
      }
      const content = record.content;
      if (typeof content !== 'string' && content !== null) {
        errors.push(`${context}.messages[${index}].content must be a string or null`);
        return;
      }
      const messageIdRaw = record.id;
      const messageId = typeof messageIdRaw === 'string' && messageIdRaw.trim().length > 0
        ? messageIdRaw.trim()
        : `${id || 'prompt'}-msg-${index}`;
      const sanitized: PromptMessage = {
        id: messageId,
        role: role as PromptMessage['role'],
        content: content === null ? null : content,
      };
      if (typeof record.name === 'string' && record.name.trim()) {
        sanitized.name = record.name.trim();
      }
      if (record.tool_call_id === null) {
        // ignore explicit nulls
      } else if (typeof record.tool_call_id === 'string' && record.tool_call_id.trim()) {
        sanitized.tool_call_id = record.tool_call_id.trim();
      }
      if (Array.isArray(record.tool_calls)) {
        sanitized.tool_calls = record.tool_calls as PromptMessage['tool_calls'];
      }
      if (record.context && typeof record.context === 'object') {
        sanitized.context = record.context as PromptMessage['context'];
      }
      sanitizedMessages.push(sanitized);
    });
  }
  if (errors.length) {
    throw new PromptValidationError(errors.join('; '));
  }
  return {
    id,
    name,
    messages: sanitizedMessages,
  };
}
