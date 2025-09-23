import type { ConversationThread, PromptMessage } from '../../shared/types';
import type { ReqLike } from '../interfaces';
import type { LiveRepos } from '../liveRepos';
import { ValidationError } from './error-handler';

function assertTimestampInvariant(thread: ConversationThread, context: string): void {
  const { id, startedAt, lastActiveAt } = thread as ConversationThread & { startedAt?: string | null; lastActiveAt?: string | null };
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
 * In-memory conversation thread mutations (pure functions over arrays)
 */
export function appendMessageToThread(
  conversations: ConversationThread[],
  threadId: string,
  message: PromptMessage | any,
  nowIso?: string,
): ConversationThread[] {
  const idx = conversations.findIndex((c) => c.id === threadId);
  if (idx === -1) return conversations;
  assertTimestampInvariant(conversations[idx], 'appendMessageToThread');
  const now = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const updated: ConversationThread = {
    ...conversations[idx],
    lastActiveAt: now,
    messages: [...conversations[idx].messages, message],
  } as ConversationThread;
  return [...conversations.slice(0, idx), updated, ...conversations.slice(idx + 1)];
}

export function appendMessagesToThread(
  conversations: ConversationThread[],
  threadId: string,
  messages: Array<PromptMessage | any>,
  nowIso?: string,
): ConversationThread[] {
  const idx = conversations.findIndex((c) => c.id === threadId);
  if (idx === -1) return conversations;
  assertTimestampInvariant(conversations[idx], 'appendMessagesToThread');
  const now = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const updated: ConversationThread = {
    ...conversations[idx],
    lastActiveAt: now,
    messages: [...conversations[idx].messages, ...messages],
  } as ConversationThread;
  return [...conversations.slice(0, idx), updated, ...conversations.slice(idx + 1)];
}

export function finalizeThreadStatus(
  conversations: ConversationThread[],
  threadId: string,
  status: 'completed' | 'failed',
  nowIso?: string,
): ConversationThread[] {
  const idx = conversations.findIndex((c) => c.id === threadId);
  if (idx === -1) return conversations;
  assertTimestampInvariant(conversations[idx], 'finalizeThreadStatus');
  const now = typeof nowIso === 'string' ? nowIso : new Date().toISOString();
  const updated: ConversationThread = {
    ...conversations[idx],
    status,
    endedAt: now,
    lastActiveAt: now,
  } as ConversationThread;
  return [...conversations.slice(0, idx), updated, ...conversations.slice(idx + 1)];
}

/**
 * Repository-backed helpers (perform read-modify-write against repos)
 */
export async function repoAppendMessage(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
  message: PromptMessage,
): Promise<ConversationThread | null> {
  return repos.appendMessagesToConversation(req, threadId, [message]);
}

export async function repoAppendMessages(
  repos: LiveRepos,
  req: ReqLike,
  threadId: string,
  messages: PromptMessage[] | any[],
): Promise<ConversationThread | null> {
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
  const conversations = await repos.getConversations(req);
  const updatedThread = conversations.find((c: ConversationThread) => c.id === threadId) || null;
  return updatedThread;
}
