-- Per-user schema (isolated database)

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('gmail','outlook')),
  email TEXT NOT NULL,
  signature TEXT NOT NULL,
  tokens_json TEXT NOT NULL CHECK(json_valid(tokens_json)),
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider_email ON accounts(provider, email);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  virtual_root TEXT NOT NULL,
  api_configs_json TEXT NOT NULL CHECK(json_valid(api_configs_json)),
  signatures_json TEXT NOT NULL CHECK(json_valid(signatures_json)),
  fetcher_auto_start INTEGER NOT NULL CHECK(fetcher_auto_start IN (0, 1)),
  session_timeout_minutes INTEGER NOT NULL CHECK(session_timeout_minutes > 0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  messages_json TEXT NOT NULL CHECK(json_valid(messages_json))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('openai')),
  prompt_id TEXT NOT NULL,
  api_config_id TEXT NOT NULL,
  enabled_optional_tools_json TEXT NOT NULL CHECK(json_valid(enabled_optional_tools_json))
);

CREATE TABLE IF NOT EXISTS directors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  api_config_id TEXT NOT NULL,
  enabled_optional_tools_json TEXT NOT NULL CHECK(json_valid(enabled_optional_tools_json)),
  agent_ids_json TEXT NOT NULL CHECK(json_valid(agent_ids_json))
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  field TEXT NOT NULL CHECK(field IN ('from','to','cc','bcc','subject','body','date')),
  regex TEXT NOT NULL,
  director_id TEXT NOT NULL,
  duplicate_allowed INTEGER NOT NULL CHECK(duplicate_allowed IN (0, 1))
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  messages_json TEXT NOT NULL CHECK(json_valid(messages_json))
);

CREATE TABLE IF NOT EXISTS imprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_items (
  id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  lifecycle_json TEXT NOT NULL CHECK(json_valid(lifecycle_json)),
  conversation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_items_conversation ON workspace_items(conversation_id);

CREATE TABLE IF NOT EXISTS workspace_item_tags (
  item_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (item_id, tag),
  FOREIGN KEY (item_id) REFERENCES workspace_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  date_iso TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json))
);

CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_iso);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('global','shared','local')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner TEXT NOT NULL,
  related_email_id TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json))
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_owner ON memory_entries(scope, owner);
CREATE INDEX IF NOT EXISTS idx_memory_entries_updated_at ON memory_entries(updated_at);

CREATE TABLE IF NOT EXISTS memory_entry_tags (
  entry_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag),
  FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('director','agent')),
  parent_id TEXT,
  director_id TEXT,
  agent_id TEXT,
  account_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  email_json TEXT NOT NULL CHECK(json_valid(email_json)),
  prompt_id TEXT NOT NULL,
  api_config_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ongoing','completed','failed')),
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  errors_json TEXT CHECK(errors_json IS NULL OR json_valid(errors_json))
);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_account ON conversation_threads(account_id);
CREATE INDEX IF NOT EXISTS idx_conversation_threads_updated ON conversation_threads(last_active_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  message_json TEXT NOT NULL CHECK(json_valid(message_json)),
  PRIMARY KEY (thread_id, seq),
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  provider TEXT NOT NULL CHECK(provider IN ('openai')),
  type TEXT NOT NULL CHECK(type IN ('request','response','error')),
  timestamp TEXT NOT NULL,
  latency_ms INTEGER,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json)),
  error TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversation_threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_events_conversation ON provider_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_provider_events_timestamp ON provider_events(timestamp);

CREATE TABLE IF NOT EXISTS fetcher_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
  provider TEXT CHECK(provider IS NULL OR provider IN ('gmail','outlook')),
  account_id TEXT NOT NULL,
  event TEXT NOT NULL,
  email_id TEXT,
  count INTEGER,
  detail_json TEXT CHECK(detail_json IS NULL OR json_valid(detail_json))
);

CREATE INDEX IF NOT EXISTS idx_fetcher_logs_timestamp ON fetcher_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_fetcher_logs_account ON fetcher_logs(account_id);

CREATE TABLE IF NOT EXISTS orchestration_logs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  timestamp TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('director','agent','tool','result')),
  outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json)),
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  FOREIGN KEY (conversation_id) REFERENCES conversation_threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestration_logs_conversation ON orchestration_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_logs_timestamp ON orchestration_logs(timestamp);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  email_id TEXT,
  account_id TEXT NOT NULL,
  provider TEXT CHECK(provider IS NULL OR provider IN ('gmail','outlook')),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT CHECK(status IS NULL OR status IN ('ok','error')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_traces_account ON traces(account_id);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);

CREATE TABLE IF NOT EXISTS trace_spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('provider_fetch','token_refresh','filters_eval','director_select','llm_call','tool_call','conversation_update','other')),
  name TEXT,
  status TEXT CHECK(status IS NULL OR status IN ('ok','error')),
  error TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  duration_ms INTEGER,
  provider TEXT CHECK(provider IS NULL OR provider IN ('gmail','outlook')),
  director_id TEXT,
  agent_id TEXT,
  tool_call_id TEXT,
  request_json TEXT CHECK(request_json IS NULL OR json_valid(request_json)),
  response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
  annotations_json TEXT CHECK(annotations_json IS NULL OR json_valid(annotations_json)),
  PRIMARY KEY (trace_id, span_id),
  FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON trace_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_spans_type ON trace_spans(type);

COMMIT;
