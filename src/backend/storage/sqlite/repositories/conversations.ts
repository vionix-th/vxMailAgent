import type { AgentThread, ConversationThread, DirectorThread, PromptMessage } from '../../../../shared/types';
import type { StorageHandle, BetterSqliteDatabase } from '../types';
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

  async list(): Promise<readonly ConversationThread[]> {
    return this.withConnection((db) => this.loadAll(db));
  }

  async getById(id: string): Promise<ConversationThread | null> {
    this.assertId(id);
    return this.withConnection((db) => this.loadOne(db, id));
  }

  async insert(thread: ConversationThread): Promise<void> {
    this.assertThread(thread);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(thread.id);
      if (exists) {
        throw new Error(`ConversationsRepository: thread '${thread.id}' already exists`);
      }
      this.writeThread(db, thread, true);
      return undefined;
    });
  }

  async update(thread: ConversationThread): Promise<void> {
    this.assertThread(thread);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(thread.id);
      if (!exists) {
        throw new Error(`ConversationsRepository: thread '${thread.id}' not found`);
      }
      this.writeThread(db, thread, true);
      return undefined;
    });
  }

  async appendMessages(threadId: string, messages: readonly PromptMessage[]): Promise<ConversationThread | null> {
    this.assertId(threadId);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('ConversationsRepository: messages array required');
    }
    return this.transaction((db) => {
      const current = this.loadOne(db, threadId);
      if (!current) return null;
      const now = new Date().toISOString();
      const next: ConversationThread = {
        ...current,
        lastActiveAt: now,
        messages: [...current.messages, ...messages],
      } as ConversationThread;
      this.writeThread(db, next, false, current.messages.length);
      return next;
    });
  }

  async finalizeStatus(threadId: string, status: 'completed' | 'failed', timestamp: string): Promise<ConversationThread | null> {
    this.assertId(threadId);
    if (typeof timestamp !== 'string' || !timestamp.trim()) {
      throw new Error('ConversationsRepository: timestamp required');
    }
    return this.transaction((db) => {
      const current = this.loadOne(db, threadId);
      if (!current) return null;
      const next: ConversationThread = {
        ...current,
        status,
        endedAt: timestamp,
        lastActiveAt: timestamp,
      } as ConversationThread;
      this.writeThread(db, next, false, current.messages.length);
      return next;
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      db.prepare('DELETE FROM conversation_messages WHERE thread_id = ?').run(id);
      const result = db.prepare('DELETE FROM conversation_threads WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  private loadAll(db: BetterSqliteDatabase): ConversationThread[] {
    const messageRows = db.prepare(
      'SELECT thread_id, message_json FROM conversation_messages ORDER BY thread_id, seq'
    ).all() as any[];
    const messageMap = new Map<string, PromptMessage[]>();
    for (const row of messageRows) {
      const list = messageMap.get(row.thread_id) ?? [];
      list.push(JSON.parse(row.message_json) as PromptMessage);
      messageMap.set(row.thread_id, list);
    }
    const threads = db.prepare(
      'SELECT id, kind, parent_id, director_id, agent_id, account_id, email_id, email_json, prompt_id, api_config_id, status, started_at, last_active_at, ended_at, result_json, errors_json FROM conversation_threads'
    ).all() as any[];
    return threads.map((row: any) => mapThread(row, messageMap));
  }

  private loadOne(db: BetterSqliteDatabase, id: string): ConversationThread | null {
    const messageRows = db
      .prepare('SELECT thread_id, message_json FROM conversation_messages WHERE thread_id = ? ORDER BY seq')
      .all(id) as any[];
    const messageMap = new Map<string, PromptMessage[]>([
      [id, messageRows.map((row) => JSON.parse(row.message_json) as PromptMessage)],
    ]);
    const row = db
      .prepare(
        'SELECT id, kind, parent_id, director_id, agent_id, account_id, email_id, email_json, prompt_id, api_config_id, status, started_at, last_active_at, ended_at, result_json, errors_json FROM conversation_threads WHERE id = ?'
      )
      .get(id) as any;
    if (!row) return null;
    return mapThread(row, messageMap);
  }

  private writeThread(
    db: BetterSqliteDatabase,
    thread: ConversationThread,
    rewriteMessages: boolean = true,
    existingMessageCount: number = 0
  ): void {
    const endedAt = assertThreadEndedAt(thread);
    let directorId: string;
    let parentId: string | null = null;
    let agentId: string | null = null;

    if (thread.kind === 'director') {
      const directorThread: DirectorThread = thread;
      ensureNull(directorThread.parentId, 'parentId', `thread ${directorThread.id}`);
      ensureNull(directorThread.agentId, 'agentId', `thread ${directorThread.id}`);
      directorId = ensureString(directorThread.directorId, 'directorId', `thread ${directorThread.id}`);
    } else {
      const agentThread: AgentThread = thread;
      parentId = ensureString(agentThread.parentId, 'parentId', `thread ${agentThread.id}`);
      agentId = ensureString(agentThread.agentId, 'agentId', `thread ${agentThread.id}`);
      directorId = ensureString(agentThread.directorId, 'directorId', `thread ${agentThread.id}`);
    }

    const emailId = typeof thread.email?.id === 'string' && thread.email.id.length > 0 ? thread.email.id : null;

    db.prepare(
      `INSERT INTO conversation_threads (id, kind, parent_id, director_id, agent_id, account_id, email_id, email_json, prompt_id, api_config_id, status, started_at, last_active_at, ended_at, result_json, errors_json)
       VALUES (@id, @kind, @parent_id, @director_id, @agent_id, @account_id, @email_id, @email_json, @prompt_id, @api_config_id, @status, @started_at, @last_active_at, @ended_at, @result_json, @errors_json)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         parent_id = excluded.parent_id,
         director_id = excluded.director_id,
         agent_id = excluded.agent_id,
         account_id = excluded.account_id,
         email_id = excluded.email_id,
         email_json = excluded.email_json,
         prompt_id = excluded.prompt_id,
         api_config_id = excluded.api_config_id,
         status = excluded.status,
         started_at = excluded.started_at,
         last_active_at = excluded.last_active_at,
         ended_at = excluded.ended_at,
         result_json = excluded.result_json,
         errors_json = excluded.errors_json`
    ).run({
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

    const messages = Array.isArray(thread.messages) ? thread.messages : [];

    if (rewriteMessages) {
      db.prepare('DELETE FROM conversation_messages WHERE thread_id = ?').run(thread.id);
      existingMessageCount = 0;
    }

    if (messages.length) {
      const insertMessage = db.prepare(
        'INSERT INTO conversation_messages (thread_id, seq, message_json) VALUES (@thread_id, @seq, @message_json)'
      );
      const start = rewriteMessages ? 0 : Math.min(existingMessageCount, messages.length);
      for (let index = start; index < messages.length; index += 1) {
        insertMessage.run({
          thread_id: thread.id,
          seq: index,
          message_json: stringify(messages[index]),
        });
      }
    }
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('ConversationsRepository: id is required');
    }
  }

  private assertThread(thread: ConversationThread): void {
    if (!thread || typeof thread !== 'object') {
      throw new Error('ConversationsRepository: thread payload required');
    }
    this.assertId(thread.id);
    if (typeof thread.startedAt !== 'string' || !thread.startedAt.trim()) {
      throw new Error(`ConversationsRepository: startedAt required for '${thread.id}'`);
    }
    if (typeof thread.lastActiveAt !== 'string' || !thread.lastActiveAt.trim()) {
      throw new Error(`ConversationsRepository: lastActiveAt required for '${thread.id}'`);
    }
  }
}
