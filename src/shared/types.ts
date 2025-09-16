export type FilterField = 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'date';

export interface Filter {
  id: string;
  field: FilterField;
  regex: string;
  directorId: string;
  /** When true, allows duplicate triggers for this director; default is a single non-duplicate trigger. */
  duplicateAllowed?: boolean;
}

/** Orchestration director definition and configuration. */
export interface Director {
  id: string;
  name: string;
  agentIds: string[];
  promptId: string;
  apiConfigId: string;
  enabledToolCalls: string[];
}

export type AgentType = 'openai'; // Future: add other providers as needed


/** Tool call kinds (full function names; unconstrained). */
export type ToolCallKind = string;

// Tool call request/response base
export interface ToolCallRequest {
  kind: ToolCallKind;
  payload: CalendarToolCall | TodoToolCall | FileSystemToolCall | MemoryToolCall;
}

export type ToolCallResult =
  | { kind: ToolCallKind; success: true; result: any }
  | { kind: ToolCallKind; success: false; result: any; error: string };

/** Calendar tool call payload. */
export type CalendarToolCall =
  | {
      action: 'read';
      provider: AccountProvider;
      accountId: string;
      dateRange: { start: string; end: string };
    }
  | {
      action: 'add';
      provider: AccountProvider;
      accountId: string;
      event: CalendarEvent;
    };

export interface CalendarEvent {
  title: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
}

/** Todo tool call payload. */
export interface TodoToolCall {
  action: 'add';
  provider: AccountProvider;
  accountId: string;
  task: TodoTask;
}

export interface TodoTask {
  title: string;
  dueDate?: string;
  notes?: string;
}

/** File system tool call payload. */
export type FileSystemToolCall =
  | {
      action: 'search';
      virtualRoot: string;
      query: string;
    }
  | {
      action: 'retrieve';
      virtualRoot: string;
      filePath: string;
    };

/** Memory tool call payload. */
export type MemoryToolCall =
  | { action: 'search'; scope: MemoryScope; query: string }
  | { action: 'add'; scope: MemoryScope; entry: MemoryEntry }
  | { action: 'add'; scope: MemoryScope; content: string; owner: string; tags?: string[] }
  | { action: 'edit'; scope: MemoryScope; entry: Pick<MemoryEntry, 'id'> & Partial<MemoryEntry> };

// Orchestration result types for diagnostics/results/attachments/notifications
export interface OrchestrationResult {
  content: string;
  attachments?: Attachment[];
  notifications?: Notification[];
  reply?: Reply;
  toolCallResult?: ToolCallResult;
}

/** Workspace content data. */
export interface WorkspaceContent {
  mimeType: string;
  encoding: 'utf8' | 'base64' | 'binary';
  data: string;
}

/** Workspace metadata. */
export interface WorkspaceMetadata {
  label?: string;
  description?: string;
  tags: string[];
}

/** Workspace provenance (reference-only). */
export interface WorkspaceProvenance {
  emailId: string;
  conversationId: string;
  createdBy: 'director' | 'agent' | 'tool';
  creatorId: string;
  toolName?: string;
}

/** Workspace lifecycle management. */
export interface WorkspaceLifecycle {
  created: string;
  updated: string;
  revision: number;
  deleted: boolean;
}

/** Workspace item (decomposed responsibilities). */
export interface WorkspaceItem {
  id: string;
  content: WorkspaceContent;
  metadata: WorkspaceMetadata;
  provenance: WorkspaceProvenance;
  lifecycle: WorkspaceLifecycle;
}

/** Input shape for creating workspace items via REST. */
export interface WorkspaceItemInput {
  content: WorkspaceContent;
  metadata: Omit<WorkspaceMetadata, 'tags'> & { tags?: string[] };
  provenance: WorkspaceProvenance;
}

/** Generic file attachment. */
export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  url?: string;
  data?: string;
}

/** Minimal email envelope captured for context. */
export interface EmailEnvelope {
  id: string;
  subject: string;
  from: string;
  /** Comma-separated recipients (normalized string). */
  to: string;
  /** Comma-separated recipients (normalized string). */
  cc?: string;
  /** Comma-separated recipients (normalized string). */
  bcc?: string;
  date: string;
  snippet?: string;
  bodyPlain?: string;
  bodyHtml?: string;
  attachments?: Attachment[];
}

/** Lightweight notification message. */
export interface Notification {
  type: 'info' | 'warning' | 'error';
  message: string;
}

/** Email reply payload. */
export interface Reply {
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
}

/** Orchestration context (reference-only). */
export interface OrchestrationContext {
  runId: string;
  emailId: string;
  accountId: string;
  directorId: string;
  agentId?: string;
  conversationId: string;
}

/** Orchestration outcome. */
export interface OrchestrationOutcome {
  success: boolean;
  result?: OrchestrationResult;
  error?: any;
  metrics?: Record<string, any>;
}

/** Orchestration event (separated concerns). */
export type DirectorContext = {
  runId: string;
  emailId: string;
  accountId: string;
  directorId: string;
  conversationId: string;
  agentId?: never;
};

export type AgentContext = {
  runId: string;
  emailId: string;
  accountId: string;
  directorId: string;
  conversationId: string;
  agentId: string;
};

export type ToolOrResultContext = OrchestrationContext; // permissive: may include agentId when tool/result originates from agent

export type OrchestrationEvent =
  | { id: string; timestamp: string; phase: 'director'; context: DirectorContext; outcome: OrchestrationOutcome }
  | { id: string; timestamp: string; phase: 'agent'; context: AgentContext; outcome: OrchestrationOutcome }
  | { id: string; timestamp: string; phase: 'tool' | 'result'; context: ToolOrResultContext; outcome: OrchestrationOutcome };



/** Fetcher log entries (persistent, structured). */
export type FetcherLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FetcherLogEntry {
  id: string;                          // assigned for deletion targeting
  timestamp: string;                   // ISO timestamp
  level: FetcherLogLevel;              // severity
  provider?: AccountProvider;          // 'gmail' | 'outlook'
  accountId: string;                   // source account id ('all' for aggregate events)
  event: string;                       // e.g., 'cycle_start', 'account_start', 'oauth_refreshed', 'messages_listed', 'message_fetched', 'account_complete', 'cycle_complete'
  message?: string;                    // human-readable message
  emailId?: string;                    // optional related email id
  count?: number;                      // optional count metric (e.g., messages listed)
  detail?: any;                        // structured payload (e.g., headers, error objects)
}

/** Orchestration agent definition and configuration. */
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  promptId: string;
  apiConfigId: string;
  enabledToolCalls: string[];
}

/** Chat message used in prompts and transcripts. */
export interface PromptMessage {
  /** Stable identifier used by editors. */
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** Optional per-message metadata (non-diagnostic). */
  context?: {
    toolSpecsHash?: string;
    variables?: Record<string, any>;
  };
}

/** Prompt template definition. */
export interface Prompt {
  id: string;
  name: string;
  messages: PromptMessage[];
}

/**
 * Prompt template item persisted per-user.
 */
export interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }>;
}

export interface Imprint {
  id: string;
  name: string;
  content: string;
  agentId: string;
}

export type AccountProvider = 'gmail' | 'outlook';

export interface Account {
  id: string;
  provider: AccountProvider;
  email: string;
  signature: string;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiry: string;
  };
}

/** Application user (authenticated principal). */
export interface User {
  /** Stable app user id (e.g., `google:{sub}`) */
  id: string;
  email: string;
  name: string;
  picture: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface ApiConfig {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  /** Optional maximum output tokens for chat completions (maps to OpenAI max_completion_tokens). */
  maxCompletionTokens?: number;
}

export type MemoryScope = 'global' | 'shared' | 'local';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  created: string;
  updated: string;
  tags?: string[];
  relatedEmailId?: string;
  owner: string; // user, agent, or director id
  metadata?: Record<string, any>;
}

/** Conversation status values. */
export type ConversationStatus = 'ongoing' | 'completed' | 'failed';

/** Base conversation thread properties. */
export interface BaseConversationThread {
  id: string;
  accountId: string;
  email: EmailEnvelope;
  promptId: string;
  apiConfigId: string;
  startedAt: string;
  lastActiveAt: string;
  /** OpenAI-aligned transcript of the conversation. */
  messages: PromptMessage[];
}

/** Director conversation thread. */
export interface DirectorThread extends BaseConversationThread {
  kind: 'director';
  parentId: null;
  directorId: string;
  agentId: null;
  status: ConversationStatus;
  endedAt: string | null;
  result?: OrchestrationResult;
  errors?: any[];
}

/** Agent conversation thread. */
export interface AgentThread extends BaseConversationThread {
  kind: 'agent';
  parentId: string;
  directorId: string;
  agentId: string;
  status: ConversationStatus;
  endedAt: string | null;
  result?: OrchestrationResult;
  errors?: any[];
}

/** Canonical conversation thread (Director or Agent). */
export type ConversationThread = DirectorThread | AgentThread;

/** Provider event kinds. */
export type ProviderEventType = 'request' | 'response' | 'error';

export interface ProviderEventUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Provider request/response/error event. */
export type LLMProvider = 'openai';

export interface ProviderEvent {
  id: string;
  conversationId: string;
  provider: LLMProvider;
  type: ProviderEventType;
  timestamp: string;
  latencyMs?: number;
  usage?: ProviderEventUsage;
  payload?: any;
  error?: string;
}

/** Structured tracing for orchestration diagnostics. */
export type SpanType =
  | 'provider_fetch'
  | 'token_refresh'
  | 'filters_eval'
  | 'director_select'
  | 'llm_call'
  | 'tool_call'
  | 'conversation_update'
  | 'other';

export interface Span {
  id: string;
  parentId?: string;
  type: SpanType;
  name?: string;
  status?: 'ok' | 'error';
  error?: string;
  start: string;
  end?: string;
  durationMs?: number;
  emailId?: string;
  provider?: AccountProvider;
  directorId?: string;
  agentId?: string;
  toolCallId?: string;
  request?: any;
  response?: any;
  annotations?: Record<string, any>;
}

export interface Trace {
  /** Correlation id for a single email-processing run. */
  id: string;
  /** Optional linkage to envelope id. */
  emailId?: string;
  accountId: string;
  provider?: AccountProvider;
  createdAt: string;
  endedAt?: string;
  status?: 'ok' | 'error';
  error?: string;
  spans: Span[];
}

/** Cleanup statistics shared between backend and frontend. */
export interface CleanupStats {
  fetcherLogs: number;
  orchestrationLogs: number;
  conversations: number;
  workspaceItems: number;
  providerEvents: number;
  traces: number;
  total: number;
}

/** Tool categorization flags. */
export interface ToolFlags {
  mandatory: boolean;       // exposed regardless of per-role allowlists
  defaultEnabled: boolean;  // exposed by default when not explicitly gated
  directorOnly: boolean;    // true → not exposed to agents
}

/** Descriptor for LLM-exposed tools (schema intentionally generic). */
export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: any;
  outputSchema?: any;
  flags: ToolFlags;
}

export type ConversationRole = 'director' | 'agent';

/** Engine-level role capabilities (orchestration powers). */
export interface RoleCapabilities {
  canSpawnAgents: boolean;
}

/** Conversation engine input. */
export interface ConversationEngineRunInput {
  messages: PromptMessage[];
  apiConfig: ApiConfig;
  role: ConversationRole;
  roleCaps: RoleCapabilities;
  toolRegistry: ToolDescriptor[];
  /** Optional context bag for diagnostics and prompt construction. */
  context?: Record<string, any>;
}

export interface ConversationEngineRunResult {
  /** Updated transcript. */
  messages: PromptMessage[];
  /** Optional token usage from provider. */
  usage?: ProviderEventUsage;
  /** Provider passthrough for tooling compatibility. */
  assistantMessage?: PromptMessage;
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  request?: any;
  response?: any;
}

export interface ConversationEngine {
  run(input: ConversationEngineRunInput): Promise<ConversationEngineRunResult>;
}
