// Shared types for backend and frontend

export type FilterField = 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'date';

export interface Filter {
  id: string;
  field: FilterField;
  regex: string;
  directorId: string;
  // If true, this filter may trigger duplicate processing for the same director.
  // If false or omitted, only a single non-duplicate trigger will be added per director.
  duplicateAllowed?: boolean;
}

export interface Director {
  id: string;
  name: string;
  // Ordered list of agent IDs assigned to this director
  agentIds: string[];
  // Assigned prompt for this director
  promptId?: string;
  // Assigned API configuration for this director
  apiConfigId: string;
  // Optional: enabled optional function tools for this director. If omitted, all optional functions are allowed.
  enabledToolCalls?: string[];
}

export type AgentType = 'openai'; // Future: add other providers as needed


// Tool call kinds supported by agents
// Use full function names end-to-end; allow any string to avoid tight coupling.
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

// Calendar tool call
export interface CalendarToolCall {
  action: 'read' | 'add';
  provider: AccountProvider;
  accountId: string;
  // For 'read': dateRange; for 'add': event details
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

// To-Do tool call
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

// File system tool call
export interface FileSystemToolCall {
  action: 'search' | 'retrieve';
  virtualRoot: string;
  query: string;
  filePath?: string;
}

// Memory tool call
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

// Workspace result model (MIME-first, unrestricted)
export interface WorkspaceItem {
  id: string;
  // Display metadata to guide rendering; optional
  label?: string;
  description?: string;
  mimeType?: string;
  encoding?: 'utf8' | 'base64' | 'binary';
  data?: string;
  tags?: string[];
  created: string;
  updated: string;
  revision?: number;
  // Soft-delete flag; item remains addressable but should be hidden by default
  deleted?: boolean;
  // Required context with provenance collapsed in
  context: {
    email: { id: string; subject?: string; from?: string; date?: string };
    director: { id: string; name?: string };
    agent?: { id?: string; name?: string };
    // Provenance information
    createdBy: 'director' | 'agent' | 'tool';
    agentId?: string;
    tool?: ToolCallKind | string;
    conversationId?: string;
  };
}

export interface WorkspaceItemInput {
  label?: string;
  description?: string;
  // Same display metadata as WorkspaceItem; agent/director may set these
  mimeType?: string;
  encoding?: 'utf8' | 'base64' | 'binary';
  data?: string;
  tags?: string[];
  // Optional write-time context snapshot; if provided, persisted as-is
  context?: {
    email: { id: string; subject?: string; from?: string; date?: string };
    director: { id: string; name?: string };
    agent?: { id?: string; name?: string };
  };
  // Optional provenance override (defaults applied by backend when omitted)
  provenance?: { by: 'director' | 'agent' | 'tool'; agentId?: string; tool?: ToolCallKind | string; conversationId?: string };
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  url?: string;
  data?: string; // base64 or inline content
}

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

export interface Notification {
  type: 'info' | 'warning' | 'error';
  message: string;
}

export interface Reply {
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
}

// Diagnostic vs. Result entries are distinct to avoid conflation in API/UI
export interface OrchestrationDiagnosticEntry {
  id?: string;
  timestamp: string;
  director: string;       // director id
  directorName?: string;  // optional display name
  agent: string;          // agent id
  agentName?: string;     // optional display name
  emailSummary: string;
  accountId?: string;     // source account used to fetch/send
  email?: EmailEnvelope;  // original email metadata and bodies
  // Diagnostics may carry a result pointer for correlation but are not required to.
  result?: OrchestrationResult | null;
  error?: any;
  // Optional, structured audit metadata (e.g., tool request payloads, provider requests, validator errors).
  detail?: any;
  // Optional grouping identifiers for hierarchical diagnostics UI
  fetchCycleId?: string;    // correlates to a single fetchEmails() cycle (usually the cycle start ISO timestamp)
  dirThreadId?: string;     // conversation id for the director thread
  agentThreadId?: string;   // conversation id for the agent thread (when applicable)
  phase?: 'director' | 'agent' | 'tool' | 'result';
}

export interface OrchestrationResultEntry {
  timestamp: string;
  director: string;       // director id
  directorName?: string;  // optional display name
  agent: string;          // agent id
  agentName?: string;     // optional display name
  emailSummary: string;
  accountId?: string;
  email?: EmailEnvelope;
  // Results must include the concrete result payload
  result: OrchestrationResult;
  // Optional error for partial/failed result generations
  error?: any;
}

// Fetcher log entries (persistent, structured)
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

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  promptId?: string;
  apiConfigId: string; // Assigned API configuration for this agent
  // No directorId field; agents are global and reusable
  // Optional: enabled optional function tools for this agent. If omitted, all optional functions are allowed.
  enabledToolCalls?: string[];
}

export interface PromptMessage {
  // Stable identifier for message ordering in editors
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  // Assistant content may be null when tool_calls are present per OpenAI schema
  content: string | null;
  name?: string;
  tool_call_id?: string;
  // Canonical OpenAI tool_calls on assistant messages
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  // Optional: per-message context snapshot for diagnostics
  context?: {
    traceId?: string;
    spanId?: string;
    toolSpecsHash?: string;
    variables?: Record<string, any>;
  };
}

export interface Prompt {
  id: string;
  name: string;
  messages: PromptMessage[];
  // model and temperature have been removed; these are defined only in ApiConfig
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

// App user (authenticated principal)
export interface User {
  id: string;           // stable app user id (e.g., `google:{sub}`)
  email: string;
  name?: string;
  picture?: string;
  createdAt: string;    // ISO
  lastLoginAt: string;  // ISO
}

export interface ApiConfig {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  // Optional maximum output tokens for chat completions (maps to OpenAI max_completion_tokens)
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

// Conversations debug types
export type ConversationStatus = 'ongoing' | 'completed' | 'failed';

export interface ConversationThread {
  id: string;
  kind: 'director' | 'agent';
  parentId?: string; // for agent threads, link to director
  directorId: string;
  agentId?: string;
  // Optional: correlation to a diagnostics Trace
  traceId?: string;
  email: EmailEnvelope;
  promptId: string;
  apiConfigId: string;
  startedAt: string;
  endedAt?: string;
  status: ConversationStatus;
  // Lifecycle timing
  lastActiveAt?: string;
  // Lifecycle terminal flag (preferred over legacy status === 'finalized')
  finalized?: boolean;
  // Canonical OpenAI-aligned transcript of the conversation
  messages: PromptMessage[]; // transcript
  result?: OrchestrationResult; // terminal result, if any
  errors?: any[]; // accumulated errors during processing
  // Workspace items (arbitrary MIME-typed content envelopes)
  workspaceItems?: WorkspaceItem[];
  // Provider identifier for convenience; raw request/response are stored separately as ProviderEvents
  provider?: 'openai';
}

// Provider events (diagnostics/audit), persisted separately from ConversationThread
export type ProviderEventType = 'request' | 'response' | 'error';

export interface ProviderEventUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderEvent {
  id: string;
  conversationId: string;
  provider: 'openai';
  type: ProviderEventType;
  timestamp: string; // ISO
  latencyMs?: number; // typically set on response/error
  usage?: ProviderEventUsage; // typically set on response
  payload?: any; // redacted request/response body
  error?: string; // error message when type === 'error'
}

// Structured tracing for orchestration diagnostics
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
  start: string; // ISO
  end?: string; // ISO
  durationMs?: number;
  emailId?: string;
  provider?: AccountProvider;
  directorId?: string;
  agentId?: string;
  toolCallId?: string;
  // Redacted payloads
  request?: any;
  response?: any;
  annotations?: Record<string, any>;
}

export interface Trace {
  id: string;            // correlation id for a single email-processing run
  emailId?: string;      // optional linkage to envelope id
  accountId?: string;
  provider?: AccountProvider;
  createdAt: string;     // ISO
  endedAt?: string;      // ISO
  status?: 'ok' | 'error';
  error?: string;
  spans: Span[];
}

// Cleanup statistics shared between backend and frontend
export interface CleanupStats {
  fetcherLogs: number;
  orchestrationLogs: number;
  conversations: number;
  workspaceItems: number;
  providerEvents: number;
  traces: number;
  total: number;
}

// Minimal tool categorization flags (KISS)
export interface ToolFlags {
  // Always enabled for applicable roles (e.g., directorOnly+mandatory => mandatory for directors only)
  mandatory?: boolean;
  // Enabled by default unless excluded by higher-level policy
  defaultEnabled?: boolean;
  // Hidden/blocked for agents; visible to directors
  directorOnly?: boolean;
}

// Descriptor for LLM-exposed tools (schema types intentionally generic for now)
export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
  flags?: ToolFlags;
}

export type ConversationRole = 'director' | 'agent';

// Engine-level role capabilities (orchestration powers, not tool metadata)
export interface RoleCapabilities {
  canSpawnAgents: boolean;
}

// Unified conversation engine interface for directors and agents
export interface ConversationEngineRunInput {
  messages: PromptMessage[];
  apiConfig: ApiConfig;
  role: ConversationRole;
  roleCaps: RoleCapabilities;
  toolRegistry: ToolDescriptor[];
  // Optional context bag for diagnostics and prompt construction
  context?: Record<string, any>;
}

export interface ConversationEngineRunResult {
  messages: PromptMessage[]; // updated transcript
  usage?: ProviderEventUsage; // optional token usage from provider
  // Provider passthrough for tooling compatibility
  assistantMessage?: PromptMessage;
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  request?: any;
  response?: any;
}

export interface ConversationEngine {
  run(input: ConversationEngineRunInput): Promise<ConversationEngineRunResult>;
}
