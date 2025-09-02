# vxMailAgent Developer Guide

## System Architecture

### Core Principles
- **Strict User Isolation**: All data access requires user context; no global fallbacks
- **Minimal Global State**: Only `users.json` is global (login registry); all other data is user-scoped
- **Security First**: All operations validate user context and path safety
- **Audit Trail**: Comprehensive logging of all operations with user context

## Dev Servers and Ports

- **Frontend**: Vite on `http://localhost:3000` with proxy for `/api` → backend. See `src/frontend/vite.config.ts`.
- **Backend**: Express on `http://localhost:3001`. Entry: `src/backend/index.ts` → `createServer()` in `src/backend/server.ts`. Health: `GET /api/health`.

## Persistence & Encryption

- Storage lives under `data/` (overridable via `VX_MAILAGENT_DATA_DIR`).
- AES‑256‑GCM at rest when `VX_MAILAGENT_KEY` is a valid 64‑char hex.
- If missing/invalid, the backend still starts in PLAINTEXT mode and logs a warning. See `src/backend/config.ts::warnIfInsecure()` and `src/backend/persistence.ts`.
- Tracing/provider events retention settings are in `src/backend/config.ts` (e.g., `TRACE_MAX_TRACES`, `PROVIDER_TTL_DAYS`).

## User Isolation & Data Access

### Security Model
- **Zero Trust**: All operations require explicit user context
- **No Global Fallbacks**: Missing user context throws errors
- **Path Safety**: All file operations are contained within user directories with strict path validation
- **Encryption**: Optional AES-256-GCM encryption for data at rest with random IVs
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
  - Each user gets isolated repository instances
  - Backed by JSON files under `data/users/{uid}/`
  - TTL-based eviction for in-memory caches

- **Repository Types**:
  - **Core**: `accounts`, `settings`
  - **Inventory**: `prompts`, `agents`, `directors`, `filters`
  - **Conversations**: `conversations`, `memory`, `workspaceItems`
  - **Logs**: `logs/fetcher.json`, `logs/orchestration.json`, `logs/provider-events.json`, `logs/traces.json`

- **Path Management**:
  - `userPaths(uid)` in `src/backend/utils/paths.ts`
  - Creates user directories with 0700 permissions
  - Validates paths to prevent directory traversal
  - No symlinks allowed
- Paths and safety: `src/backend/utils/paths.ts`
  - `userPaths(uid)` derives absolute, validated paths under `DATA_DIR/users/{uid}` and creates directories with 0700 permissions.
  - Disallows symlinks and path traversal; validates containment under the per-user root.
  - **SECURITY**: Only `USERS_FILE` constant exists - all other global file constants have been removed to prevent data leakage.
  - Config (multi-user limits): `src/backend/config.ts`
    - `USER_REGISTRY_TTL_MINUTES`, `USER_REGISTRY_MAX_ENTRIES`
    - `USER_MAX_CONVERSATIONS`, `USER_MAX_LOGS_PER_TYPE`, `USER_MAX_FILE_SIZE_MB`
    - `FETCHER_MANAGER_TTL_MINUTES`, `FETCHER_MANAGER_MAX_FETCHERS`
    - Behavior is always per-user; no legacy global stores.

#### 3. Repository Access Helpers (standard pattern)
Location: `src/backend/utils/repo-access.ts`

- Exposed helpers to enforce user context and centralize repo access:
  - `requireReq(req)` → returns `UserRequest` with guaranteed user context or throws.
  - `requireUid(req)` → returns current user's UID (string).
  - `requireRepos(req)` → returns the per-user `RepoBundle`.
  - `requireUserRepo(req, key)` → returns a specific repo from `RepoBundle`.
  - `repoGetAll(req, key)` / `repoSetAll(req, key, next)` → typed helpers for common CRUD patterns.

- Usage rules:
  - Do not import `getUserContext` or `hasUserContext` in routes/services. These are internal to middleware and helpers.
  - Always call `requireReq(req)` at the beginning of a handler before any repository or UID access.
  - For logging/audit, prefer `requireUid(ureq)` to include the UID.
  - For passing repositories to tool handlers, use `requireRepos(ureq)`.

- Example (route):
```ts
app.get('/api/settings', requireUserContext as any, async (req: UserRequest, res) => {
  const ureq = requireReq(req);
  const uid = requireUid(ureq);
  const all = repoGetAll<any>(ureq, 'settings');
  const settings = Array.isArray(all) && all[0] || { /* defaults */ };
  logger.info('GET /api/settings', { uid });
  res.json(settings);
});
```

- Example (service):
```ts
export function loadSettings(req: UserRequest) {
  const ureq = requireReq(req);
  const settings = repoGetAll<any>(ureq, 'settings')[0] || defaultSettings();
  logger.debug('Loaded settings', { uid: requireUid(ureq) });
  return settings;
}
```

### User Isolation Enforcement

- **Settings Service**: `src/backend/services/settings.ts`
  - `loadSettings(req)` and `saveSettings(settings, req)` require user context
  - No global settings access - throws error if user context missing
- **Logging Service**: `src/backend/services/logging.ts`
  - All logging functions require user context parameter
  - No global repository fallbacks - throws error if user context missing
- **Route Dependencies**: All route registrations pass user context to data access functions
- **Fetcher Manager**: Per-user fetcher instances with isolated settings persistence

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
   - Creates/updates user in `users.json`
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
- **Content-Security-Policy**: `script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; object-src 'none'`
- **Referrer-Policy**: `no-referrer`

### Request Validation, CSRF, and Rate Limiting (Current State)

- **Request validation**: There is no global schema validation middleware. A minimal JSON Schema subset validator lives in `src/backend/validation.ts` and is used only by tool-call handlers in `src/backend/toolCalls.ts` to validate tool parameters. Other routes rely on path safety checks, basic type checks, and strict user-context enforcement.
- **CSRF**: No CSRF middleware (e.g., `csurf`) is enabled. Sessions use `HttpOnly` cookies with `SameSite=Lax` and `Secure` (prod) which mitigates cross-site requests. For cross-site deployments or if third-party contexts are required, add CSRF protection at the Express layer or at an API gateway.
- **Rate limiting**: Not implemented in the backend. Enforce at a reverse proxy/API gateway (recommended) or add Express middleware per deployment.

### Google OAuth Clients (Split)

- Provider (Gmail) OAuth client — used for linking Gmail accounts and refreshing tokens.
  - Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
  - Redirect URI (local dev): `http://localhost:3000/oauth/callback` (frontend receives code).
- Login (OIDC) OAuth client — used ONLY for app login sessions.
  - Env vars: `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI`.
  - Redirect URI (local dev): `http://localhost:3001/api/auth/google/callback` (backend handles callback).
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

#### Create Item
```
POST /api/workspaces/:id/items
Content-Type: application/json

{
  "label": "Example",
  "mimeType": "text/plain",
  "data": "SGVsbG8gd29ybGQh",
  "encoding": "base64",
  "tags": ["example"]
}
```
- Creates a new workspace item
- Required fields: `mimeType`, `data`
- Returns: `WorkspaceItem`

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
- Redirect URI for provider accounts (local dev) should be `http://localhost:3000/oauth/callback`, handled by `src/frontend/src/OAuthCallback.tsx`.
- On success, the backend persists or updates the account in the per-user repository and returns it; no additional `POST /api/accounts` is required.
- On missing/invalid refresh tokens, certain endpoints may return `{ ok: false, authorizeUrl }` to trigger re-authorization.

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
DELETE /api/fetcher/logs/purge
```
- Control email fetching
- View and manage fetch logs
- Background processing control

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
  - Response: `{ ok: false, error: "missing_refresh_token", authorizeUrl: string }`

- **Invalid Grant**
  - Status: 401
  - Response: `{ ok: false, error: "invalid_grant", authorizeUrl: string }`

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
  - `TRACE_VERBOSE`, `TRACE_PERSIST`, `TRACE_MAX_PAYLOAD`, `TRACE_MAX_SPANS`, `TRACE_MAX_TRACES`, `TRACE_TTL_DAYS`, `TRACE_REDACT_FIELDS`
- Provider events retention:
  - `PROVIDER_MAX_EVENTS`, `PROVIDER_TTL_DAYS`
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
- Dependencies: `UserFetcherDeps` includes `settings` and repository accessors for user-isolated data access.
- **SECURITY**: Account-related dependencies (`getAccounts`, `setAccounts`) have been removed - accounts are accessed through user-scoped repositories only.
- Fetcher state is tracked in-memory; settings are persisted to the user's `settings.json` via user context.
- Tracks last access time and evicts idle instances based on `FETCHER_MANAGER_TTL_MINUTES` with a cap of `FETCHER_MANAGER_MAX_FETCHERS`.
- Orchestration integration: fetchers can trigger orchestration runs via the `runOrchestration` callback.

### Cleanup Service

- Module: `src/backend/services/cleanup.ts`
- Exposes `createCleanupService()` which returns operations to remove logs, conversations, traces, and workspace items by id.
- Backed by a `RepositoryHub` accessor that abstracts underlying persistence.
