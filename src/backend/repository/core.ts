import type {
  Account,
  Agent,
  ConversationThread,
  Director,
  Filter,
  Imprint,
  MemoryEntry,
  Prompt,
  PromptMessage,
  TemplateItem,
  WorkspaceItem,
  User,
} from '../../shared/types';

export interface SettingsRow {
  virtualRoot: string;
  apiConfigs: any[];
  signatures: Record<string, string>;
  fetcherAutoStart: boolean;
  sessionTimeoutMinutes: number;
}

export interface SettingsRepository {
  load(): Promise<SettingsRow | null>;
  save(settings: SettingsRow): Promise<void>;
  delete(): Promise<void>;
}

export interface SystemUsersRepository {
  list(): Promise<readonly User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  upsert(user: User): Promise<User>;
  delete(id: string): Promise<boolean>;
}

export interface AccountsRepository {
  list(): Promise<readonly Account[]>;
  getById(id: string): Promise<Account | null>;
  insert(account: Account): Promise<void>;
  update(account: Account): Promise<void>;
  updateTokens(id: string, tokens: Account['tokens']): Promise<Account>;
  delete(id: string): Promise<boolean>;
}

export interface PromptsRepository {
  list(): Promise<readonly Prompt[]>;
  getById(id: string): Promise<Prompt | null>;
  insert(prompt: Prompt): Promise<void>;
  update(prompt: Prompt): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface TemplatesRepository {
  list(): Promise<readonly TemplateItem[]>;
  getById(id: string): Promise<TemplateItem | null>;
  insert(template: TemplateItem): Promise<void>;
  update(template: TemplateItem): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface AgentsRepository {
  list(): Promise<readonly Agent[]>;
  getById(id: string): Promise<Agent | null>;
  insert(agent: Agent): Promise<void>;
  update(agent: Agent): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface DirectorsRepository {
  list(): Promise<readonly Director[]>;
  getById(id: string): Promise<Director | null>;
  insert(director: Director): Promise<void>;
  update(director: Director): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface FiltersRepository {
  list(): Promise<readonly Filter[]>;
  getById(id: string): Promise<Filter | null>;
  insert(filter: Filter): Promise<void>;
  update(filter: Filter): Promise<void>;
  delete(id: string): Promise<boolean>;
  reorder(orderedIds: readonly string[]): Promise<void>;
}

export interface ImprintsRepository {
  list(): Promise<readonly Imprint[]>;
  getById(id: string): Promise<Imprint | null>;
  insert(imprint: Imprint): Promise<void>;
  update(imprint: Imprint): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface MemoryRepository {
  list(): Promise<readonly MemoryEntry[]>;
  findById(id: string): Promise<MemoryEntry | null>;
  insert(entry: MemoryEntry): Promise<void>;
  update(entry: MemoryEntry): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteMany(ids: readonly string[]): Promise<number>;
}

export interface ConversationsRepository {
  list(): Promise<readonly ConversationThread[]>;
  getById(id: string): Promise<ConversationThread | null>;
  findOngoingAgentThread(parentId: string, agentId: string): Promise<ConversationThread | null>;
  insert(thread: ConversationThread): Promise<void>;
  update(thread: ConversationThread): Promise<void>;
  appendMessages(threadId: string, messages: readonly PromptMessage[]): Promise<ConversationThread>;
  finalizeStatus(threadId: string, status: 'completed' | 'failed', timestamp: string): Promise<ConversationThread | null>;
  delete(id: string): Promise<boolean>;
}

export interface WorkspaceItemsRepository {
  list(): Promise<readonly WorkspaceItem[]>;
  listByConversation(conversationId: string): Promise<readonly WorkspaceItem[]>;
  insert(item: WorkspaceItem): Promise<void>;
  update(item: WorkspaceItem): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteByConversation(conversationId: string): Promise<number>;
}
