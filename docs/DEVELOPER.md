# Backend Type System Documentation

## Overview

The backend type system has been comprehensively refactored to enforce strict logical coherence, eliminate optional fields that should be mandatory, separate mixed responsibilities, and remove redundant data copying. This ensures types serve as reliable contracts for development.

## Core Type Principles

### Mandatory Fields
All critical identifiers and core data fields are now mandatory:
- `Director.promptId` - Required for director functionality
- `Agent.promptId` - Required for agent functionality  
- `EmailEnvelope.to`, `EmailEnvelope.date` - Core email metadata
- `ConversationThread` discriminated union fields - Explicit thread type handling
- All entity IDs are mandatory strings

### Separated Responsibilities

#### WorkspaceItem Decomposition
```typescript
interface WorkspaceItem {
  id: string;
  content: WorkspaceContent;     // Data storage
  metadata: WorkspaceMetadata;   // Labels, descriptions, tags
  provenance: WorkspaceProvenance; // Reference-only tracking
  lifecycle: WorkspaceLifecycle; // Creation, updates, deletion
}
```

#### ConversationThread Discriminated Union
```typescript
type ConversationThread = DirectorThread | AgentThread;

interface DirectorThread {
  kind: 'director';
  parentId: null;
  agentId: null;
  // ... other fields
}

interface AgentThread {
  kind: 'agent';
  parentId: string;  // Required reference to parent
  agentId: string;   // Required agent identifier
  // ... other fields
}
```

#### OrchestrationEvent Separation
```typescript
interface OrchestrationEvent {
  context: OrchestrationContext;  // What happened
  outcome: OrchestrationOutcome;  // Result/error
}
```

### Reference-Only Provenance
Eliminated redundant data copying by using reference-only fields:
- `WorkspaceProvenance` contains only IDs, not copied data
- `OrchestrationContext` references entities by ID
- Lookup utilities provided for accessing referenced data

## Migration Guidelines

### WorkspaceItem Usage
```typescript
// OLD - flat structure
const item = {
  id: '123',
  label: 'Document',
  mimeType: 'text/plain',
  data: 'content',
  created: '2024-01-01'
};

// NEW - decomposed structure
const item: WorkspaceItem = {
  id: '123',
  content: {
    mimeType: 'text/plain',
    encoding: 'utf8',
    data: 'content'
  },
  metadata: {
    label: 'Document',
    tags: []
  },
  provenance: {
    emailId: 'email-123',
    conversationId: 'conv-456',
    createdBy: 'agent',
    creatorId: 'agent-789'
  },
  lifecycle: {
    created: '2024-01-01',
    updated: '2024-01-01',
    revision: 1,
    deleted: false
  }
};
```

### ConversationThread Creation
```typescript
// Director thread
const directorThread: DirectorThread = {
  kind: 'director',
  parentId: null,
  agentId: null,
  endedAt: null,
  // ... other required fields
};

// Agent thread
const agentThread: AgentThread = {
  kind: 'agent',
  parentId: 'parent-thread-id',
  agentId: 'agent-id',
  endedAt: null,
  // ... other required fields
};
```

## Runtime Validation

The type system enforces compile-time safety, but runtime validation should be added for external inputs:

```typescript
function validateWorkspaceItemInput(input: any): WorkspaceItemInput {
  if (!input.content?.mimeType) {
    throw new ValidationError('mimeType is required');
  }
  if (!input.provenance?.emailId) {
    throw new ValidationError('emailId is required for provenance');
  }
  return input as WorkspaceItemInput;
}
```

## Deprecated Types

- `OrchestrationDiagnosticEntry` - Use `OrchestrationEvent` instead
- Flat WorkspaceItem structure - Use decomposed interfaces
- Optional IDs in core entities - All IDs are now mandatory

## Best Practices

1. **No Defaults For Invariants** - Required fields must error when missing
2. **Reference-Only Provenance** - Store IDs, not copied data
3. **Explicit Type Discrimination** - Use discriminated unions for variant types
4. **Focused Interfaces** - Single responsibility per interface
5. **Mandatory Identifiers** - All entity IDs are required strings

This type system provides a solid foundation for reliable, maintainable code development.

## Orchestrator Contract (Authoritative)

This section is the operational contract the backend must uphold. It is used as acceptance criteria after refactors.

1) Director turn execution

- Call the provider chat API with:
  - Messages = full OpenAI-compatible transcript
  - Tools = effective tool registry:
    - Mandatory tools are always available.
    - Optional tools are included only when enabled on the Director (`director.enabledToolCalls`).
    - Dynamic `agent__<id>` tools are exposed only for the Director’s assigned `agentIds` (when provided).
- Append the assistant message (may contain `tool_calls`).
- If assistant contains `tool_calls[]`, execute each call and then immediately run another director turn unless the step limit is reached.

2) Tool-call execution semantics

- For each `tool_call` in order:
  - `agent__<id>`: ensure or create an agent child conversation under the director (`parentId = directorThread.id`), then run the agent loop (bounded steps). Return a director `tool` message matching `tool_call_id` with a brief result summary (e.g., `{ status, agentThreadId }`).
  - Workspace/Memory/Calendar/Todo: validate parameters, execute handler, persist through the appropriate repository (e.g., Workspaces via `workspaceItems` repo), and emit a `tool` message with the result (OpenAI schema).

3) Agent loop

- Up to LOOP_MAX steps:
  - Call the provider chat API with agent messages and tools.
    - Tools = effective tool registry for the Agent: mandatory + optional from `agent.enabledToolCalls` only.
  - Append assistant; if assistant has no `tool_calls`, break.
  - For each `tool_call`, execute tool, append `tool` message, and continue.

4) Provider events

- Log request/response/error for both director and agents via `ProviderEventLogger(req)` so that records persist to the per-user `provider_events` table.

5) Transcript invariants

- The canonical transcript must always preserve the OpenAI sequence:
  - assistant (with `tool_calls[]`) → tool (one per call, matching `tool_call_id`) → assistant → ...
- Conversations are the sole source of truth for chat content; provider events are persisted separately.

#### Conversation mutations (canonical)
- All thread message appends and status changes MUST use helpers in `src/backend/services/conversation-mutations.ts`.
- Repo-backed helpers (persisted): `repoAppendMessage()`, `repoAppendMessages()`, `repoFinalizeThreadStatus()`, `repoGetThreadById()`.
- Do not mutate `messages`, `lastActiveAt`, or `endedAt` directly; use the helpers to preserve invariants and timestamps consistently.
 - ESLint enforces this rule for backend sources via flat config `src/backend/eslint.config.cjs` using `no-restricted-syntax` selectors; CI runs lint in `.github/workflows/tests.yml`.

### Note: ESLint Configuration
The ESLint configuration for the backend uses the v9 flat config and lives at `src/backend/eslint.config.cjs`.

Pinned versions (backend):
- ESLint: `^9`
- @typescript-eslint/parser: `^8`
- @typescript-eslint/eslint-plugin: `^8`
- TypeScript: `~5.7` (pinned for parser compatibility)

Lint command (backend): `npm run lint` from `src/backend/`.

6) Workspace persistence

- Scope is Director-thread scoped. Each email × director pair has its own workspace bucket identified by the Director thread id.
- Workspace items are persisted via the Workspaces repository (no direct embedding into `ConversationThread`).
- Canonical layer: `WorkspaceService` (`src/backend/services/workspace-service.ts`) centralizes all workspace operations (list/get/add/update/soft-delete/hard-delete, and optional conversation association updates). All routes and tool handlers must delegate to this service.
- Tool handlers and routes write to `workspaceItems` through `WorkspaceService` using `ReqLike` context, carrying provenance (`context`) and `conversationId = <directorThreadId>`.

### Acceptance checks (post‑change)

- Director assistant messages that contain `tool_calls` are always followed by `tool` messages and then another director assistant turn (unless step limit reached).
- `agent__*` calls create or reuse agent threads under the director; agent transcripts grow; agent runs can include their own tool calls. Dynamic agent tools are limited to the Director’s assigned agents.
- Provider events exist for director and agents for each model call.
- Workspace items created by tools are persisted under the user’s `workspaceItems` repo and visible via Workspaces routes, under the parent Director thread id.
 
### Route delegation to ConversationOrchestrator

- All conversation-step logic is centralized in `src/backend/services/conversation-orchestrator.ts`.
- The conversations route (`src/backend/routes/conversations.ts`) now delegates both branches to the orchestrator:
  - Director threads: `orchestrator.runConversationLoop({ ...context }, userReq, maxSteps)`
  - Agent threads: `orchestrator.runAgentAssistant(thread, userReq)`
- The orchestrator encapsulates:
  - Provider event logging for both roles via `ProviderEventLogger`.
  - Director tool-call processing (e.g., `workspace_add_item`, `workspace_list_items`).
  - Agent tool gating (mandatory + `agent.enabledToolCalls`) and agent loop execution.
- Rationale: single source of truth for conversation behavior, thinner routes, and consistent diagnostics/persistence.

## Terminology (Authoritative)

- Thread — Canonical API object representing the persisted chat transcript and metadata. This repository uses `ConversationThread` for the same concept.
- Conversation — Informal synonym for Thread in docs.
- Session — Transient usage window (not a persisted API object). We create Threads, not Sessions.
- Turn — A single exchange: one user message and the assistant’s reply. In this codebase, a Director step may include tool execution followed by the subsequent assistant turn.

# vxMailAgent Developer Guide

## System Architecture

### Core Principles
- **Strict User Isolation**: All data access requires user context; no global fallbacks
- **Minimal Global State**: Only the shared SQLite database (`data/system.sqlite3`) and `security-audit.log` (append-only JSONL) are global; all other data is user-scoped
- **Security First**: All operations validate user context and path safety
- **Audit Trail**: Comprehensive logging of all operations with user context

## Dev Servers and Ports

- **Frontend**: Vite on `http://localhost:3000` with proxy for `/api` → backend. See `src/frontend/vite.config.ts`.
- **Backend**: Express on `http://localhost:3001`. Entry: `src/backend/index.ts` → `createServer()` in `src/backend/server.ts`. Health: `GET /api/health`.

## Persistence & Encryption

- Storage lives under `data/` (overridable via `VX_MAILAGENT_DATA_DIR`).
- Persistence uses SQLite: `data/system.sqlite3` holds global metadata (user registry); every user gets a dedicated `data/users/<uid>/user.sqlite3` database for accounts, prompts, conversations, logs, traces, etc. When running from the compiled output (`dist/`), execute `node scripts/sqlite-init.ts` once to pre-create the shared database.

### SQLite Operational Cheat Sheet

- **Bootstrap:**
  1. Install native deps – `npm install` inside `src/backend` pulls `better-sqlite3`.
  2. Initialize schema – `npm run build && node src/backend/scripts/sqlite-init.ts` (or run the script from `dist/backend/scripts/sqlite-init.js` in production).
  3. Optional override – set `VX_MAILAGENT_DATA_DIR=/var/vxmailagent` (or any writable absolute path) before boot so all SQLite files land under that directory.
- **Local inspection:** `sqlite3 $VX_MAILAGENT_DATA_DIR/users/<uid>/user.sqlite3 '.tables'` lists user tables; add `.schema conversation_threads` or `SELECT * FROM provider_events LIMIT 5;` for deeper dives.
- **Backups:** run `sqlite3 $VX_MAILAGENT_DATA_DIR/users/<uid>/user.sqlite3 "VACUUM INTO '/tmp/<uid>.sqlite3'"` for a consistent snapshot. Repeat for `data/system.sqlite3`. Automate with the same command wrapped in cron/systemd timer if routine backups are required.
- **Vacuum & maintenance:** periodic `VACUUM` is built into SQLite; for manual compaction run `sqlite3 <db> 'VACUUM;'` during low traffic windows.
- **Tests:** Integration coverage lives under `src/backend/tests/sqlite/*.cjs`. To run a suite locally you must build first (`npm run build`) and export minimal env vars (`JWT_SECRET`, Google/Outlook placeholders). Example:
  ```bash
  JWT_SECRET=<>=32chars> JWT_EXPIRES_IN_SEC=86400 \
  GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_REDIRECT_URI=https://example.com \
  OUTLOOK_CLIENT_ID=dummy OUTLOOK_CLIENT_SECRET=dummy OUTLOOK_REDIRECT_URI=https://example.com \
  node --test src/backend/tests/sqlite/settings.integration.cjs
  ```
- **Diagnostics:** use `node src/backend/utils/test-auth.js list` (after `npm run build`) to enumerate system users from SQLite, or generate a short-lived JWT for manual API calls.
- Page encryption is supported by linking an encrypted SQLite runtime (SQLCipher/SEE) and providing keys at startup. All legacy JSON encryption code has been removed; the backend no longer consumes an application-level encryption key.
- Tracing/provider events retention settings are enforced in SQL (`TRACE_TTL_DAYS`, `PROVIDER_TTL_DAYS`, `ORCHESTRATION_TTL_DAYS`, `FETCHER_TTL_DAYS`).

## Environment Variables (authoritative)

Source of truth: `src/backend/config.ts`, `src/backend/services/logger.ts`, and `src/backend/utils/paths.ts`.

- **Core**
  - `PORT` (default: 3001) — backend port.
  - `CORS_ORIGIN` (default: `*`) — allowed origin for CORS. **Production must set a concrete origin** (e.g., `https://mail.example.com`). For local dev use `http://localhost:3000` to match Vite; backend warns when relying on the dev default.
  - `VX_MAILAGENT_DATA_DIR` — optional override for `data/` root. If unset, `resolveDataDir()` probes common locations under repo root. See `src/backend/utils/paths.ts`.

- **OAuth: Google (Provider: Gmail/Calendar/Tasks)**
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (default: empty). Local dev redirect: `http://localhost:3001/api/accounts/oauth/google/callback` (backend callback).

- **OAuth: Google (Login: OIDC session)**
  - `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI` (default: empty). Local dev redirect should be `http://localhost:3001/api/auth/google/callback` (backend handles code).

- **OAuth: Outlook**
  - `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REDIRECT_URI` (default: empty). Local dev redirect: `http://localhost:3001/api/accounts/oauth/outlook/callback` (backend callback).

- **Auth / Sessions (JWT)**
  - `JWT_SECRET` (default: `dev-insecure-jwt`) — signs login session tokens and short-lived OAuth state tokens.
  - `JWT_EXPIRES_IN_SEC` (default: `86400`) — session TTL in seconds.

- **Logging** (pino)
  - `NODE_ENV` — `production` → JSON logs, else pretty dev logs.
  - `LOG_LEVEL` — default `info` in production, `debug` in development. See `src/backend/services/logger.ts`.

- **Diagnostics / Tracing**
  - `TRACE_PERSIST` (default: `true` when unset) — persist traces to disk.
  - `TRACE_VERBOSE` (default: `false`) — include redacted payload excerpts.
  - `TRACE_MAX_PAYLOAD` (default: `32768`) — bytes per payload.
  - `TRACE_MAX_SPANS` (default: `1000`) — cap spans per trace.
  - `TRACE_TTL_DAYS` (default: `7`) — retention TTL.
  - `TRACE_REDACT_FIELDS` (default: `authorization,api_key,access_token,refresh_token,set-cookie,cookie`) — comma-separated, case-insensitive.

- **Retention (logs & events)**
  - `PROVIDER_TTL_DAYS` (default: `7`)
  - `FETCHER_TTL_DAYS` (default: `7`)
  - `ORCHESTRATION_TTL_DAYS` (default: `7`)

- **Timeouts (ms)**
  - `OPENAI_REQUEST_TIMEOUT_MS` (default: `30000`)
  - `GRAPH_REQUEST_TIMEOUT_MS` (default: `15000`)
  - `PROVIDER_REQUEST_TIMEOUT_MS` (default: `30000`)
  - `CONVERSATION_STEP_TIMEOUT_MS` (default: `45000`)
  - `TOOL_EXEC_TIMEOUT_MS` (default: `30000`)

- **Multi-user isolation & limits**
  - `USER_REGISTRY_TTL_MINUTES` (default: `60`)
  - `USER_REGISTRY_MAX_ENTRIES` (default: `1000`)
  - `USER_MAX_FILE_SIZE_MB` (default: `50`)
  - `USER_MAX_CONVERSATIONS` (default: `10000`)
  - `USER_MAX_LOGS_PER_TYPE` (default: `10000`)
  - `FETCHER_MANAGER_TTL_MINUTES` (default: `60`)
  - `FETCHER_MANAGER_MAX_FETCHERS` (default: `100`)

Notes:
- OpenAI API keys are managed per user in Settings and stored per-user; there is no global `OPENAI_API_KEY` for production use.
- All variables are read at process start. Restart the backend after changes.

## User Isolation & Data Access

### Security Model
- **Zero Trust**: All operations require explicit user context
- **No Global Fallbacks**: Missing user context throws errors
- **Path Safety**: All storage resides in SQLite files under user directories with strict path validation
- **Encryption**: Integrate SQLCipher/SEE for database encryption when required (legacy AES-256-GCM JSON flow deprecated)
- **Audit Logging**: All operations are logged with user context
- **Rate Limiting**: Not implemented in the backend; recommend gateway or Express middleware if needed

### Security Best Practices

1. **Authentication**
   - Always use `requireAuth` middleware for protected routes
   - Never trust client-provided user IDs
   - Validate all inputs against user context

2. **Data Access**
   - Always use repository methods, never direct filesystem access
   - Validate all paths with `userPaths()`
   - Use repository transactions for atomic operations

3. **Error Handling**
   - Never expose internal errors to clients
   - Log all security-relevant events
   - Use specific error types for different failure modes

### Implementation Details

#### 1. User Context Middleware
Location: `src/backend/middleware/user-context.ts`
- `attachUserContext`:
  - Validates `uid` (alphanumeric/underscore/hyphen, 1-64 chars)
  - Forbids `uid`/`userId` in params, query, or body
  - Attaches `{ uid, repos }` to request
- `requireUserContext`:
  - Enforces user context for protected routes
  - Returns 401 if missing or invalid

#### 2. Repository Registry
Location: `src/backend/repository/registry.ts`
- **Per-User Isolation**:
  - Each user gets isolated repository instances backed by `data/users/{uid}/user.sqlite3`
  - TTL-based eviction for in-memory caches

- **Repository Types**:
  - **Core**: `accounts`, `settings`
  - **Inventory**: `prompts`, `agents`, `directors`, `filters`
  - **Conversations**: `conversations`, `memory`, `workspaceItems`
- **Logs**: SQLite tables (`fetcher_logs`, `orchestration_logs`, `provider_events`, `traces`)

- **Path Management**:
  - `userPaths(uid)` in `src/backend/utils/paths.ts`
  - Creates user directories with 0700 permissions
  - Validates paths to prevent directory traversal
  - No symlinks allowed
- Paths and safety: `src/backend/utils/paths.ts`
  - `userPaths(uid)` derives absolute, validated paths under `DATA_DIR/users/{uid}` and creates directories with 0700 permissions.
  - Disallows symlinks and path traversal; validates containment under the per-user root.
  - **SECURITY**: Only `USER_ACCOUNTS_FILE` constant exists for the global user accounts registry; all other data is per-user to prevent leakage.
  - Config (multi-user limits): `src/backend/config.ts`
    - `USER_REGISTRY_TTL_MINUTES`, `USER_REGISTRY_MAX_ENTRIES`
    - `USER_MAX_CONVERSATIONS`, `USER_MAX_LOGS_PER_TYPE`, `USER_MAX_FILE_SIZE_MB`
    - `FETCHER_MANAGER_TTL_MINUTES`, `FETCHER_MANAGER_MAX_FETCHERS`
    - Behavior is always per-user; no legacy global stores.

#### 3. LiveRepos Interface (Canonical Repository Access)
Location: `src/backend/liveRepos.ts`

The `LiveRepos` interface is the canonical source of truth for all repository access methods. All route modules and services use this interface directly, eliminating wrapper bloat and dependency interfaces.

- **Direct Repository Access**: Routes accept `LiveRepos` directly instead of verbose wrapper objects
- **Service Parameter Pattern**: Routes requiring additional services accept explicit `services` parameters with typed method signatures
- **No Wrapper Interfaces**: All `*RoutesDeps` interfaces have been eliminated in favor of direct `LiveRepos` usage

#### 4. Route Helpers: Generic CRUD
Location: `src/backend/routes/helpers.ts`

- `createCrudRoutes<T>(app, basePath, repoFns, options?, callbacks?)`
  - Purpose: Eliminate duplicate CRUD route code by centralizing list/get/create/update/delete logic.
  - Endpoints: `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id` under `basePath`. Optional `PUT /reorder`.
  - `repoFns`: typed contract exposing `{ list, getById, create, update, delete, reorder? }`
  - `options`:
    - `enableReorder?: boolean` — adds `PUT /reorder` for ordered resources.
  - `callbacks` (all optional):
    - `validate?(obj: T, phase: 'create'|'update')` — throw to reject.
    - `transform?(obj: T, phase: 'create'|'update') => T` — normalize inputs.
    - `sanitize?(obj: T) => T` — strip/clean fields before persistence.
    - `onError?(err: unknown, ctx)` — custom error handling.
  - Logging & Errors: Centralized try/catch with structured logger; unknown errors are stringified safely.

- Refactored modules using the helper:
  - `src/backend/routes/agents.ts`
  - `src/backend/routes/directors.ts`
  - `src/backend/routes/filters.ts` (with `enableReorder: true`)
  - `src/backend/routes/imprints.ts`

- Notes:
  - Keep resource-specific validation minimal in route modules; heavy validation belongs in services when needed.
  - Prefer transformations to maintain consistent shapes (e.g., normalize IDs, map prompt references).
  - Reorder handler expects `[{ id, order }, ...]` or a new ordered array depending on repo implementation.

### User Isolation Enforcement

- **Settings Service**: `src/backend/services/settings.ts`
  - `loadSettings(req)` and `saveSettings(settings, req)` require user context
  - No global settings access - throws error if user context missing
- **Logging Service**: `src/backend/services/logging.ts`
  - All logging functions require user context parameter
  - No global repository fallbacks - throws error if user context missing
- **Route Dependencies**: All route registrations pass `LiveRepos` and services directly to route handlers
- **Fetcher Manager**: Per-user fetcher instances accepting `LiveRepos` and service functions directly

## Authentication & Session Management

### Session Security
- **JWT-based Sessions**:
  - Signed tokens stored in `vx.session` cookie
  - **HttpOnly**: Prevents XSS token theft
  - **SameSite=Lax**: CSRF protection
  - **Secure**: Only sent over HTTPS in production
  - **Short Expiry**: Configurable TTL (default 24h)

### Authentication Flow
1. **Initiate Login**
   ```
   GET /api/auth/google/initiate
   ```
   - Returns Google OAuth2 URL with scopes: `openid email profile`
   - Generates and stores PKCE code verifier

2. **OAuth Callback**
   ```
   GET /api/auth/google/callback?code=<code>&state=<state>
   ```
   - Validates state and PKCE verifier
   - Exchanges code for tokens
  - Creates/updates user in the shared `system.sqlite3` database
   - Sets `vx.session` cookie

3. **Session Validation**
   ```
   GET /api/auth/whoami
   ```
   - Validates session token
   - Returns `{ user }` or 401

4. **Logout**
   ```
   POST /api/auth/logout
   ```
   - Clears session cookie
   - Invalidates token

### Security Headers (Production)
- **HTTPS redirect + HSTS (prod only)**: backend redirects HTTP→HTTPS and sets `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `NODE_ENV=production`
- **Content-Security-Policy**: API responses use a strict policy: `default-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'` (no `unsafe-inline` or `unsafe-eval`).
- **Referrer-Policy**: `no-referrer`

### Request Validation, CSRF, and Rate Limiting (Current State)

- **Request validation**: There is no global schema validation middleware. A minimal JSON Schema subset validator lives in `src/backend/validation.ts` and is used only by tool-call handlers in `src/backend/toolCalls.ts` to validate tool parameters. Other routes rely on path safety checks, basic type checks, and strict user-context enforcement.
- **CSRF**: No CSRF middleware (e.g., `csurf`) is enabled. Sessions use `HttpOnly` cookies with `SameSite=Lax` and `Secure` (prod) which mitigates cross-site requests. For cross-site deployments or if third-party contexts are required, add CSRF protection at the Express layer or at an API gateway.
- **Rate limiting**: Not implemented in the backend. Enforce at a reverse proxy/API gateway (recommended) or add Express middleware per deployment.

### Google OAuth Clients (Split)

- Provider (Gmail) OAuth client — used for linking Gmail accounts and refreshing tokens.
  - Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
  - Redirect URI (local dev): `http://localhost:3001/api/accounts/oauth/google/callback` (backend handles callback and persists account).
- Login (OIDC) OAuth client — used ONLY for app login sessions.
  - Env vars: `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI` (default: empty). Local dev redirect should be `http://localhost:3001/api/auth/google/callback` (backend handles code).
  - URL builder: `src/backend/oauth/googleLogin.ts::buildGoogleLoginAuthUrl()` (scopes: `openid email profile`, `access_type=online`, `prompt=select_account`).

## Workspace API

### Security Model
- All workspace operations require user authentication
- User isolation enforced via repository pattern
- No cross-user data access

### Endpoints

#### List Items
```
GET /api/workspaces/:id/items?includeDeleted=true
```
- Lists all items in the workspace
- `includeDeleted`: Optional, includes soft-deleted items
- Returns: `{ items: WorkspaceItem[] }`

#### Get Item
```
GET /api/workspaces/:id/items/:itemId
```
- Retrieves a single workspace item
- Returns: `WorkspaceItem`

#### Update Item
```
PUT /api/workspaces/:id/items/:itemId
Content-Type: application/json

{
  "expectedRevision": 1,
  "updates": {
    "label": "Updated",
    "data": "..."
  }
}
```
- Updates an existing workspace item
- `expectedRevision`: Required for optimistic concurrency control
- Returns: Updated `WorkspaceItem`

#### Delete Item
```
DELETE /api/workspaces/:id/items/:itemId?hard=true
```
- Soft-deletes an item by default
- `hard=true`: Permanently deletes the item
- Returns: `{ success: boolean }`

Note: Workspace items are created by orchestration only. There is no REST endpoint to create items directly.

## API Reference

### Health
```
GET /api/health
```
- Public endpoint
- Returns: `{ status: "ok", timestamp: string }`

### Authentication
- `GET /api/auth/google/initiate` - Start OAuth flow
- `GET /api/auth/google/callback` - OAuth callback
- `GET /api/auth/whoami` - Get current user
- `POST /api/auth/logout` - End session

### Accounts
```
GET    /api/accounts
POST   /api/accounts
GET    /api/accounts/:id
PUT    /api/accounts/:id
DELETE /api/accounts/:id
POST   /api/accounts/:id/refresh
```
- Manage email accounts (Gmail/Outlook)
- Supports OAuth flows for account linking
- Token refresh and validation

#### Provider OAuth (Accounts)

- All provider OAuth endpoints require an authenticated session and user context.
- State tokens are JWT-signed with `JWT_SECRET` and expire quickly (~10 minutes).

Initiate endpoints (return a signed authorization URL):
```
GET /api/accounts/oauth/google/initiate
GET /api/accounts/oauth/outlook/initiate
```

Callback endpoints (exchange code, verify state, persist account for current user, and return the account JSON):
```
GET /api/accounts/oauth/google/callback?code=<code>&state=<state>
GET /api/accounts/oauth/outlook/callback?code=<code>&state=<state>
```

Notes:
- Redirect URIs for provider accounts (local dev) should be backend callbacks:
  - `http://localhost:3001/api/accounts/oauth/google/callback`
  - `http://localhost:3001/api/accounts/oauth/outlook/callback`
- The backend handles the code exchange and persists/updates the account for the authenticated user; no additional `POST /api/accounts` is required.
- On missing/invalid refresh tokens, certain endpoints may return `{ ok: false, reauthUrl }` to trigger re-authorization.

### Prompts
```
GET    /api/prompts
POST   /api/prompts
GET    /api/prompts/:id
PUT    /api/prompts/:id
DELETE /api/prompts/:id
POST   /api/prompts/assist
```
- Manage and optimize prompts
- Assist endpoint provides context-aware suggestions

### Fetcher
```
GET    /api/fetcher/status
POST   /api/fetcher/start
POST   /api/fetcher/stop
POST   /api/fetcher/fetch
POST   /api/fetcher/run
GET    /api/fetcher/logs
DELETE /api/fetcher/logs/:id
DELETE /api/fetcher/logs     # bulk; body { ids: string[] }
```
- Control email fetching
- View and manage fetch logs
- Background processing control

Note: Full purge of fetcher logs is via the canonical cleanup endpoint:

```
DELETE /api/cleanup/fetcher-logs
```

### Workspaces
```
GET    /api/workspaces/:id/items
GET    /api/workspaces/:id/items/:itemId
PUT    /api/workspaces/:id/items/:itemId
DELETE /api/workspaces/:id/items/:itemId
```
- Read/update/delete workspace items
- Creation occurs via orchestration only (no REST create)
- Versioned updates with optimistic concurrency

### Diagnostics (Admin)
```
# Runtime
GET    /api/diagnostics/runtime

# Orchestration diagnostics
GET    /api/orchestration/diagnostics
DELETE /api/orchestration/diagnostics/:id
DELETE /api/orchestration/diagnostics   # bulk; body { ids: string[] }

# Unified diagnostics tree
GET    /api/diagnostics/unified
GET    /api/diagnostics/unified/:nodeId
```
- Runtime info, orchestration diagnostics listing and deletion, and unified diagnostics view
- Admin/debug only; not rendered in user Results view

### Cleanup (Admin)
```
GET    /api/cleanup/stats
DELETE /api/cleanup/all
DELETE /api/cleanup/fetcher-logs
DELETE /api/cleanup/orchestration-logs
DELETE /api/cleanup/conversations
DELETE /api/cleanup/workspace-items
DELETE /api/cleanup/provider-events
DELETE /api/cleanup/traces
```
- Purge data by category for current user; canonical endpoints only (no generic `:type`).

### OAuth Token Management

### Token Refresh
```
POST /api/accounts/:id/refresh
```
- Refreshes OAuth tokens
- Handles token rotation
- Returns updated account info

### API Probes
```
GET /api/accounts/:id/gmail-test
GET /api/accounts/:id/outlook-test
```
- Tests API connectivity
- Validates token scopes
- Returns provider-specific metadata

### Error Handling
- **Missing Refresh Token**
  - Status: 400
  - Response: `{ ok: false, error: "missing_refresh_token", reauthUrl: string }`

- **Invalid Grant**
  - Status: 401
  - Response: `{ ok: false, error: "invalid_grant", reauthUrl: string }`

- **Network Error**
  - Status: 502
  - Response: `{ ok: false, error: "network", message: string }`

- **Other Errors**
  - Status: 500
  - Response: `{ ok: false, error: "other", message: string }`

### Logging
All token operations are logged with:
- Timestamp
- Operation type
- Account ID and email
- Error category (if any)
- Request metadata

#### Backend Logger (pino)
- Centralized structured logger at `src/backend/services/logger.ts` (pino).
- Dev: pretty output via `pino-pretty`, level `debug`. Prod: JSON, level `info` by default.
- HTTP requests are logged in `src/backend/server.ts`.
- Use `logger.info|warn|error(msg, meta)` with optional context; avoid `console.*` in backend code.

#### Frontend Logging
- `src/frontend/src/utils/log.ts` logs only in development.
- No logging in production builds; avoids direct console usage at runtime.

## Frontend Shared Components

### MessageListEditor
- Location: `src/frontend/src/components/MessageListEditor.tsx`
- Purpose: Reusable editor for prompt/template message arrays; handles add/change/delete/reorder with minimal boilerplate.
- Props (core):
  - `messages`: array of `{ role: 'system'|'user'|'assistant'|'tool', content: string }`-like objects
  - `onChange(nextMessages)` — emit full updated array
  - Options: `defaultRole?: 'system'|'user'|'assistant'|'tool'`, `minMessages?`, `maxMessages?`, `showVariableInsert?`, `translationPrefix?`
- Current usage:
  - `src/frontend/src/PromptEditDialog.tsx` (defaultRole: `user`, variable insertion enabled)
  - `src/frontend/src/TemplateEditDialog.tsx` (defaultRole: `system`, variable insertion disabled)
- Notes:
  - Centralizes UX and array ops to keep dialogs lean.
  - Internationalized labels via i18next using the provided `translationPrefix`.

## Prompt Assistant: Optional Context Inclusion

Endpoint: POST /api/prompts/assist

- Purpose: Optimize an existing prompt using the Prompt Optimizer template and optional application context packs.
- Required:
  - prompt — the prompt object (with messages[])
  - target — explicit target kind: one of ["director", "agent"]
- Optional:
  - including — controls additional context packs appended to the optimizer context. Does not change any saved prompts.

including accepted forms:
- "optional" → includes [examples, policies]
- "all" → includes all known packs [affordances, docs-lite, types-lite, routes-lite, examples, policies]
- string or array of explicit pack names, e.g. "examples,policies" or ["examples","policies"]

Notes:
- Base pack selection comes from the existing `context` parameter (defaults remain unchanged).
- `including` is merged with `context`; duplicates are de-duplicated.
- The optimizer message always excludes the full Affordances body from the application-context block to avoid duplication; affordances are included separately.
- No persisted prompts are modified by this endpoint.

Request example (body):
```json
{
  "prompt": { "id": "agent_translator", "name": "Translator", "messages": [ { "role": "system", "content": "..." } ] },
  "target": "agent",
  "including": "optional"
}
```

Request example (query):
```
POST /api/prompts/assist?including=all&target=director
```

Response shape:
```json
{
  "improved": { "id": "...", "name": "...", "messages": [ {"role":"system","content":"..."}, ... ] },
  "notes": "assistant-side notes"
}
```

## Context Packs (reference)
- affordances: role affordances and tool capabilities (authoritative)
- docs-lite: excerpts from DESIGN.md, Example.md, docs/DEVELOPER.md, docs/TROUBLESHOOTING.md
- types-lite: selected exports from src/shared/types.ts
- routes-lite: detected backend routes under src/backend/routes/
- examples: files from data/prompt-examples/
- policies: concise prompt-crafting policies

## Tracing & Provider Events (Admin)

- Tracing config in `src/backend/config.ts`:
  - `TRACE_VERBOSE`, `TRACE_PERSIST`, `TRACE_MAX_PAYLOAD`, `TRACE_MAX_SPANS`, `TRACE_TTL_DAYS`, `TRACE_REDACT_FIELDS`
- Provider events retention:
  - `PROVIDER_TTL_DAYS` (per-user caps enforced by `USER_MAX_LOGS_PER_TYPE`)
- Diagnostics endpoints surface traces/provider events for admin only; they are not rendered in the user Results view.

### Orchestration & Fetcher Logs Retention

- Repository-level pruning enforces TTL and max item caps per user for both orchestration and fetcher logs.
- Config in `src/backend/config.ts`:
  - `ORCHESTRATION_TTL_DAYS` (default 7) — TTL for orchestration logs
  - `FETCHER_TTL_DAYS` — TTL for fetcher logs
  - `USER_MAX_LOGS_PER_TYPE` — per-type cap applied by repositories
- Implementations: `FileOrchestrationLogRepository` and `FileFetcherLogRepository` in `src/backend/repository/fileRepositories.ts`.
- Policy: Single canonical endpoints only; no route aliases.

### Logging Utilities

- Module: `src/backend/services/logging.ts`
- Core helpers:
  - `logOrch()` and `logProviderEvent()` append orchestration and provider diagnostic entries.
  - `beginTrace()`, `beginSpan()`, `endSpan()`, and `endTrace()` manage structured traces when `TRACE_PERSIST` is enabled.
  - `annotateSpan()` merges metadata into an existing span.
- **CRITICAL**: All repositories require user context - no global fallbacks exist to prevent data leakage between users.

### Fetcher Manager

- Module: `src/backend/services/fetcher-manager.ts`
- Manages per-user fetcher instances with lifecycle (start/stop/fetch/run).
- **Architecture**: Constructor accepts `LiveRepos` directly along with explicit logging and tool handler service functions, eliminating wrapper factory functions.
- **Dependencies**: No wrapper interfaces - uses `LiveRepos` and service functions directly for user-isolated data access.
- Fetcher state is tracked in-memory; settings are persisted to the user's `settings.json` via user context.
- Tracks last access time and evicts idle instances based on `FETCHER_MANAGER_TTL_MINUTES` with a cap of `FETCHER_MANAGER_MAX_FETCHERS`.
- Orchestration integration: fetchers can trigger orchestration runs via the `runOrchestration` callback.

### Cleanup Routes

- Cleanup endpoints are backed directly by per-user repositories via `LiveRepos`; there is no CleanupService or RepositoryHub abstraction.
- Workspace purge: `DELETE /api/cleanup/workspace-items` delegates to `WorkspaceService.purgeAll()` for centralized behavior.
- Canonical endpoints are listed under Cleanup (Admin); they remove logs, conversations, traces, and workspace items by id.
## Tools and Delegation (Unified Model)

- Single registry (`src/shared/tools.ts`) defines all tools (mandatory vs optional). Optional tools are exposed only if explicitly enabled per director/agent settings.
- Spec building: The backend uses one builder (`src/backend/utils/tools.ts`). The engine accepts a pre-gated `toolRegistry` from callers (e.g., orchestrator) and falls back to builder defaults when not provided.
- Routing: All tool calls go through the generic router (`src/backend/toolCalls.ts`) which enforces JSON schema + semantic validation and `TOOL_EXEC_TIMEOUT_MS`.
- Delegation: Use `delegate_to_agent` to run agent work from a director thread. Dynamic `agent__{id}` function tools are deprecated and no longer injected by the engine.

### Running Unit Tests Directly (shim-free)

For deterministic unit results, bypass the aggregate harness:

```
NODE_ENV=test VX_TEST_MOCK_OPENAI=true TRACE_PERSIST=false \
node --test --test-timeout=30000 --test-concurrency=1 \
src/backend/tests/<file>.cjs
```

Added tests: `delegate_to_agent.unit.cjs`, `list_agents.unit.cjs`, `list_tools.unit.cjs`, `describe_tool.unit.cjs`.
