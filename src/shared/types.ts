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
  promptId?: string;
  apiConfigId: string;
  enabledToolCalls?: string[];
}

export type AgentType = 'openai'; // Future: add other providers as needed


/** Tool call kinds (full function names; unconstrained). */
export type ToolCallKind = string;

// Tool call request/response base
export interface ToolCallRequest {
  kind: ToolCallKind;
  payload: CalendarToolCall | TodoToolCall | FileSystemToolCall | MemoryToolCall;
}

export interface ToolCallResult {
  kind: ToolCallKind;
  success: boolean;
  result: any;
  error?: string;
}

/** Calendar tool call payload. */
export interface CalendarToolCall {
  action: 'read' | 'add';
  provider: AccountProvider;
  accountId: string;
  dateRange?: { start: string; end: string };
  event?: CalendarEvent;
}

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
export interface FileSystemToolCall {
  action: 'search' | 'retrieve';
  virtualRoot: string;
  query: string;
  filePath?: string;
}

/** Memory tool call payload. */
export interface MemoryToolCall {
  action: 'search' | 'add' | 'edit';
  scope: MemoryScope;
  query?: string;
  entry?: MemoryEntry;
}

// Orchestration result types for diagnostics/results/attachments/notifications
export interface OrchestrationResult {
  content: string;
  attachments?: Attachment[];
  notifications?: Notification[];
  reply?: Reply;
  toolCallResult?: ToolCallResult;
}

/** Workspace item (MIME-first, unrestricted). */
export interface WorkspaceItem {
  id: string;
  label?: string;
  description?: string;
  mimeType?: string;
  encoding?: 'utf8' | 'base64' | 'binary';
  data?: string;
  tags?: string[];
  created: string;
  updated: string;
  revision?: number;
  /** Soft delete marker; item remains addressable but hidden by default. */
  deleted?: boolean;
  /** Required provenance context. */
  context: {
    email: { id: string; subject?: string; from?: string; date?: string };
    director: { id: string; name?: string };
    agent?: { id?: string; name?: string };
    createdBy: 'director' | 'agent' | 'tool';
    agentId?: string;
    tool?: ToolCallKind | string;
    conversationId?: string;
  };
}

/** Input shape for creating/updating workspace items via REST. */
export interface WorkspaceItemInput {
  label?: string;
  description?: string;
  mimeType?: string;
  encoding?: 'utf8' | 'base64' | 'binary';
  data?: string;
  tags?: string[];
  /** Optional write-time context snapshot; if provided, persisted as-is. */
  context?: {
    email: { id: string; subject?: string; from?: string; date?: string };
    director: { id: string; name?: string };
    agent?: { id?: string; name?: string };
  };
  /** Optional provenance override; defaults applied by backend if omitted. */
  provenance?: { by: 'director' | 'agent' | 'tool'; agentId?: string; tool?: ToolCallKind | string; conversationId?: string };
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
  date?: string;
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

/** Diagnostic entry for orchestration (separate from results). */
export interface OrchestrationDiagnosticEntry {
  id?: string;
  timestamp: string;
  director: string;
  directorName?: string;
  agent: string;
  agentName?: string;
  emailSummary: string;
  emailId: string;
  accountId?: string;
  email?: EmailEnvelope;
  result?: OrchestrationResult | null;
  error?: any;
  detail?: any;
  fetchCycleId?: string;
  dirThreadId?: string;
  agentThreadId?: string;
  phase?: 'director' | 'agent' | 'tool' | 'result';
}

/** Result entry for orchestration outcomes. */
export interface OrchestrationResultEntry {
  timestamp: string;
  director: string;
  directorName?: string;
  agent: string;
  agentName?: string;
  emailSummary: string;
  emailId: string;
  accountId?: string;
  email?: EmailEnvelope;
  result: OrchestrationResult;
  error?: any;
}

/** Fetcher log entries (persistent, structured). */
export type FetcherLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FetcherLogEntry {
  id?: string;                       // assigned for deletion targeting
  timestamp: string;                   // ISO timestamp
  level: FetcherLogLevel;              // severity
  provider?: AccountProvider;          // 'gmail' | 'outlook'
  accountId?: string;                  // source account id
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
  promptId?: string;
  apiConfigId: string;
  enabledToolCalls?: string[];
}

/** Chat message used in prompts and transcripts. */
export interface PromptMessage {
  /** Stable identifier used by editors (optional). */
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** Optional per-message diagnostic context. */
  context?: {
    traceId?: string;
    spanId?: string;
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
  name?: string;
  picture?: string;
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
  owner?: string; // user, agent, or director id
  metadata?: Record<string, any>;
}

/** Conversation status values. */
export type ConversationStatus = 'ongoing' | 'completed' | 'failed';

/** Canonical conversation thread (Director or Agent). */
export interface ConversationThread {
  id: string;
  kind: 'director' | 'agent';
  /** For agent threads, link to parent director thread id. */
  parentId?: string;
  directorId: string;
  agentId?: string;
  /** Optional correlation to a unified diagnostics Trace. */
  traceId?: string;
  email: EmailEnvelope;
  promptId: string;
  apiConfigId: string;
  startedAt: string;
  endedAt?: string;
  status: ConversationStatus;
  /** Last activity timestamp. */
  lastActiveAt?: string;
  /** OpenAI-aligned transcript of the conversation. */
  messages: PromptMessage[];
  /** Terminal result, if any. */
  result?: OrchestrationResult;
  /** Accumulated errors during processing. */
  errors?: any[];
  provider?: 'openai';
}

/** Provider event kinds. */
export type ProviderEventType = 'request' | 'response' | 'error';

export interface ProviderEventUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Provider request/response/error event. */
export interface ProviderEvent {
  id: string;
  conversationId: string;
  provider: 'openai';
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
  accountId?: string;
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
  mandatory?: boolean;
  defaultEnabled?: boolean;
  directorOnly?: boolean;
}

/** Descriptor for LLM-exposed tools (schema intentionally generic). */
export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
  flags?: ToolFlags;
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
