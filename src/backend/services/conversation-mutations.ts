import type { ConversationThread, PromptMessage } from '../../shared/types';
import type { ReqLike } from '../interfaces';
import type { LiveRepos } from '../liveRepos';
import { ValidationError } from './error-handler';

export function assertThreadTimestamps(thread: ConversationThread, context: string): void {
  const { startedAt, lastActiveAt } = thread as ConversationThread & { startedAt?: string | null; lastActiveAt?: string | null };
  if (typeof startedAt !== 'string' || !startedAt.trim()) {
    throw new ValidationError(`${context}: startedAt missing`, 'CONVERSATION_STARTED_AT_MISSING');
  }
  if (typeof lastActiveAt !== 'string' || !lastActiveAt.trim()) {
    throw new ValidationError(`${context}: lastActiveAt missing`, 'CONVERSATION_LAST_ACTIVE_MISSING');
  }
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new ValidationError(`${context}: startedAt invalid`, 'CONVERSATION_STARTED_AT_INVALID');
  }
  if (Number.isNaN(Date.parse(lastActiveAt))) {
    throw new ValidationError(`${context}: lastActiveAt invalid`, 'CONVERSATION_LAST_ACTIVE_INVALID');
  }
}

/**
 * Repository-backed helpers (perform read-modify-write against repos)
 */
export async function repoAppendMessage(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
  message: PromptMessage,
): Promise<ConversationThread> {
  return repos.appendMessagesToConversation(req, threadId, [message]);
}

export async function repoAppendMessages(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
  messages: PromptMessage[] | any[],
): Promise<ConversationThread> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError('appendMessagesToConversation requires non-empty messages array', 'CONVERSATION_APPEND_EMPTY');
  }
  return repos.appendMessagesToConversation(req, threadId, messages as any[]);
}

export async function repoFinalizeThreadStatus(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  await repos.finalizeThreadStatusAtomic(req, threadId, status);
}

export async function repoGetThreadById(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
): Promise<ConversationThread | null> {
  return repos.getConversationById(req, threadId);
}
