import type { AgentThread, ConversationThread, DirectorThread, PromptMessage } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function ensureString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} missing for ${context}`);
  }
  return value;
}

function ensureNull(value: unknown, field: string, context: string): void {
  if (value !== null) {
    throw new Error(`${field} must be null for ${context}`);
  }
}

function normalizeEndedAt(threadId: string, raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  throw new Error(`ended_at invalid for thread ${threadId}`);
}

function assertThreadEndedAt(thread: ConversationThread): string | null {
  if (thread.endedAt === null) return null;
  if (typeof thread.endedAt === 'string' && thread.endedAt.length > 0) return thread.endedAt;
  throw new Error(`endedAt invalid for thread ${thread.id}`);
}

function mapThread(row: any, messages: Map<string, PromptMessage[]>): ConversationThread {
  const threadMessages = messages.get(row.id) ?? [];

  if (row.kind === 'director') {
    ensureNull(row.parent_id, 'parent_id', `director thread ${row.id}`);
    const directorId = ensureString(row.director_id, 'director_id', `director thread ${row.id}`);
    if (row.agent_id !== null) {
      throw new Error(`agent_id must be null for director thread ${row.id}`);
    }
    const endedAt = normalizeEndedAt(row.id, row.ended_at);
    return {
      id: row.id,
      kind: 'director',
      parentId: null,
      directorId,
      agentId: null,
      accountId: row.account_id,
      email: JSON.parse(row.email_json),
      promptId: row.prompt_id,
      apiConfigId: row.api_config_id,
      status: row.status,
      startedAt: row.started_at,
      lastActiveAt: row.last_active_at,
      endedAt,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      errors: row.errors_json ? JSON.parse(row.errors_json) : undefined,
      messages: threadMessages,
    } as ConversationThread;
  }

  if (row.kind === 'agent') {
    const parentId = ensureString(row.parent_id, 'parent_id', `agent thread ${row.id}`);
    const directorId = ensureString(row.director_id, 'director_id', `agent thread ${row.id}`);
    const agentId = ensureString(row.agent_id, 'agent_id', `agent thread ${row.id}`);
    const endedAt = normalizeEndedAt(row.id, row.ended_at);
    return {
      id: row.id,
      kind: 'agent',
      parentId,
      directorId,
      agentId,
      accountId: row.account_id,
      email: JSON.parse(row.email_json),
      promptId: row.prompt_id,
      apiConfigId: row.api_config_id,
      status: row.status,
      startedAt: row.started_at,
      lastActiveAt: row.last_active_at,
      endedAt,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      errors: row.errors_json ? JSON.parse(row.errors_json) : undefined,
      messages: threadMessages,
    } as ConversationThread;
  }

  throw new Error(`Unknown conversation kind: ${row.kind}`);
}

export class ConversationsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  private loadAll(db: any): ConversationThread[] {
    const messageRows = db.prepare(
      'SELECT thread_id, message_json FROM conversation_messages ORDER BY thread_id, seq'
    ).all();
    const messageMap = new Map<string, PromptMessage[]>();
    for (const row of messageRows) {
      const list = messageMap.get(row.thread_id) ?? [];
      list.push(JSON.parse(row.message_json) as PromptMessage);
      messageMap.set(row.thread_id, list);
    }
    const threads = db.prepare(
      'SELECT id, kind, parent_id, director_id, agent_id, account_id, email_id, email_json, prompt_id, api_config_id, status, started_at, last_active_at, ended_at, result_json, errors_json FROM conversation_threads'
    ).all();
    return threads.map((row: any) => mapThread(row, messageMap));
  }

  private rewrite(db: any, threads: ConversationThread[]): void {
    db.prepare('DELETE FROM conversation_messages').run();
    db.prepare('DELETE FROM conversation_threads').run();

    const insertThread = db.prepare(
      'INSERT INTO conversation_threads (id, kind, parent_id, director_id, agent_id, account_id, email_id, email_json, prompt_id, api_config_id, status, started_at, last_active_at, ended_at, result_json, errors_json) VALUES (@id, @kind, @parent_id, @director_id, @agent_id, @account_id, @email_id, @email_json, @prompt_id, @api_config_id, @status, @started_at, @last_active_at, @ended_at, @result_json, @errors_json)'
    );
    const insertMessage = db.prepare(
      'INSERT INTO conversation_messages (thread_id, seq, message_json) VALUES (@thread_id, @seq, @message_json)'
    );

    for (const thread of threads) {
      if (!Array.isArray(thread.messages)) {
        throw new Error(`messages missing for thread ${thread.id}`);
      }
      const endedAt = assertThreadEndedAt(thread);
      let directorId: string;
      let parentId: string | null = null;
      let agentId: string | null = null;

      if (thread.kind === 'director') {
        const directorThread: DirectorThread = thread;
        if (directorThread.parentId !== null) {
          throw new Error(`parentId must be null for director thread ${directorThread.id}`);
        }
        if (directorThread.agentId !== null) {
          throw new Error(`agentId must be null for director thread ${directorThread.id}`);
        }
        directorId = ensureString(directorThread.directorId, 'directorId', `thread ${directorThread.id}`);
      } else if (thread.kind === 'agent') {
        const agentThread: AgentThread = thread;
        parentId = ensureString(agentThread.parentId, 'parentId', `thread ${agentThread.id}`);
        agentId = ensureString(agentThread.agentId, 'agentId', `thread ${agentThread.id}`);
        directorId = ensureString(agentThread.directorId, 'directorId', `thread ${agentThread.id}`);
      } else {
        const unexpected: never = thread;
        throw new Error(`Unknown conversation kind: ${(unexpected as { kind: unknown }).kind}`);
      }

      const emailId = typeof thread.email?.id === 'string' && thread.email.id.length > 0 ? thread.email.id : null;

      insertThread.run({
        id: thread.id,
        kind: thread.kind,
        parent_id: parentId,
        director_id: directorId,
        agent_id: agentId,
        account_id: thread.accountId,
        email_id: emailId,
        email_json: stringify(thread.email),
        prompt_id: thread.promptId,
        api_config_id: thread.apiConfigId,
        status: thread.status,
        started_at: thread.startedAt,
        last_active_at: thread.lastActiveAt,
        ended_at: endedAt,
        result_json: thread.result ? stringify(thread.result) : null,
        errors_json: thread.errors ? stringify(thread.errors) : null,
      });
      thread.messages.forEach((msg, index) => {
        insertMessage.run({
          thread_id: thread.id,
          seq: index,
          message_json: stringify(msg),
        });
      });
    }
  }

  async getAll(): Promise<ConversationThread[]> {
    return this.withConnection((db) => this.loadAll(db));
  }

  async setAll(threads: ConversationThread[]): Promise<void> {
    await this.transaction((db) => {
      this.rewrite(db, threads);
      return undefined;
    });
  }

  async mutate(updater: (current: ConversationThread[]) => Promise<ConversationThread[]> | ConversationThread[]): Promise<ConversationThread[]> {
    return this.transaction(async (db) => {
      const current = this.loadAll(db);
      const next = await Promise.resolve(updater([...current]));
      this.rewrite(db, next);
      return next;
    });
  }
}
