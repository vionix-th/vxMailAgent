# vxMailAgent Developer Guide

## Dev Servers and Ports

- Frontend: Vite on `http://localhost:3000` with proxy for `/api` → backend. See `src/frontend/vite.config.ts`.
- Backend: Express on `http://localhost:3001`. Entry: `src/backend/index.ts` → `createServer()` in `src/backend/server.ts`. Health: `GET /api/health`.

## Persistence & Encryption

- Storage lives under `data/` (overridable via `VX_MAILAGENT_DATA_DIR`).
- AES‑256‑GCM at rest when `VX_MAILAGENT_KEY` is a valid 64‑char hex.
- If missing/invalid, the backend still starts in PLAINTEXT mode and logs a warning. See `src/backend/config.ts::warnIfInsecure()` and `src/backend/persistence.ts`.
- Tracing/provider events retention settings are in `src/backend/config.ts` (e.g., `TRACE_MAX_TRACES`, `PROVIDER_TTL_DAYS`).

## Per-User Isolation & Repository Registry

**CRITICAL SECURITY REQUIREMENT**: All data access must be user-isolated. Only `users.json` is allowed as global application data.

- Middleware: `src/backend/middleware/user-context.ts`
  - `attachUserContext` requires prior auth and validates `uid` (alphanumeric/underscore/hyphen, 1–64 chars). Forbids `uid`/`userId` in params, query, or body.
  - Attaches `{ uid, repos }` where `repos` is a per-user bundle from the repository registry.
  - `requireUserContext` enforces presence of user context for protected routes.
- Repository Registry: `src/backend/repository/registry.ts`
  - Provides per-user repositories backed by JSON files under `data/users/{uid}/` with TTL-based eviction.
  - Core repos: `accounts`, `settings`.
  - Inventory: `prompts`, `agents`, `directors`, `filters`, `imprints`, `workspaceItems`.
  - Conversations/memory: `conversations`, `memory`.
  - Logs: `logs/provider-events.json`, `logs/traces.json`, `logs/orchestration.json`; fetcher logs at `logs/fetcher.json`.
- Paths and safety: `src/backend/utils/paths.ts`
  - `userPaths(uid)` derives absolute, validated paths under `DATA_DIR/users/{uid}` and creates directories with 0700 permissions.
  - Disallows symlinks and path traversal; validates containment under the per-user root.
  - **SECURITY**: Only `USERS_FILE` constant exists - all other global file constants have been removed to prevent data leakage.
- Config (multi-user limits): `src/backend/config.ts`
  - `USER_REGISTRY_TTL_MINUTES`, `USER_REGISTRY_MAX_ENTRIES`
  - `USER_MAX_CONVERSATIONS`, `USER_MAX_LOGS_PER_TYPE`, `USER_MAX_FILE_SIZE_MB`
  - Behavior is always per-user; no legacy global stores.

### User Isolation Enforcement

- **Settings Service**: `src/backend/services/settings.ts`
  - `loadSettings(req)` and `saveSettings(settings, req)` require user context
  - No global settings access - throws error if user context missing
- **Logging Service**: `src/backend/services/logging.ts`
  - All logging functions require user context parameter
  - No global repository fallbacks - throws error if user context missing
- **Route Dependencies**: All route registrations pass user context to data access functions
- **Fetcher Manager**: Per-user fetcher instances with isolated settings persistence

## Authentication & Sessions

- Stateless login backed by a signed JWT stored in `vx.session` (HttpOnly, SameSite=Lax; `Secure` in production).
- Endpoints (see `src/backend/routes/auth-session.ts`):
  - `GET /api/auth/google/initiate` → returns Google OAuth2 authorization URL (scopes: `openid email profile`).
  - `GET /api/auth/google/callback?code=&state=` → exchanges code, upserts user, sets cookie, responds with `{ user }`.
  - `GET /api/auth/whoami` → returns `{ user }` when authenticated or HTTP 401.
  - `POST /api/auth/logout` → clears the `vx.session` cookie and ends the session.
- Route guard: `requireAuth` protects all routes except the public allowlist: `/api/auth/*`, `/api/auth/whoami`, `/api/health`.
- Provider OAuth endpoints under `/api/oauth2/*` (Google/Outlook) are protected by `requireAuth`. Linking provider accounts is an authenticated action.
- Production security: HTTP→HTTPS redirect when behind a proxy and HSTS header `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

### Google OAuth Clients (Split)

- Provider (Gmail) OAuth client — used for linking Gmail accounts and refreshing tokens.
  - Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
  - Redirect URI (local dev): `http://localhost:3000/oauth/callback` (frontend receives code).
- Login (OIDC) OAuth client — used ONLY for app login sessions.
  - Env vars: `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI`.
  - Redirect URI (local dev): `http://localhost:3001/api/auth/google/callback` (backend handles callback).
  - URL builder: `src/backend/oauth/googleLogin.ts::buildGoogleLoginAuthUrl()` (scopes: `openid email profile`, `access_type=online`, `prompt=select_account`).

## Workspace Semantics (Current)

- Routes are namespaced by `:id`, but items are stored in a per-user shared repository irrespective of `:id` (partitioning can be added later). See `src/backend/routes/workspaces.ts`.
- Endpoints implemented:
  - `GET /api/workspaces/:id/items` (supports `?includeDeleted=true`)
  - `POST /api/workspaces/:id/items`
  - `GET /api/workspaces/:id/items/:itemId`
  - `PUT /api/workspaces/:id/items/:itemId` (expects `expectedRevision` for conflict detection)
  - `DELETE /api/workspaces/:id/items/:itemId[?hard=true]`

## Backend API Overview (routes/)

- Health
  - `GET /api/health` — `src/backend/routes/health.ts`
- Authentication (login/session)
  - `GET /api/auth/google/initiate`, `GET /api/auth/google/callback`, `GET /api/auth/whoami` — `src/backend/routes/auth-session.ts`
- Prompts
  - `GET /api/prompts`, `POST /api/prompts`, `PUT /api/prompts/:id`, `DELETE /api/prompts/:id` — `src/backend/routes/prompts.ts`
  - `POST /api/prompts/assist` — Prompt Optimizer with app context packs. Requires `prompt.messages[]` and `target` in `{director|agent}`.
- Prompt Templates
  - `GET /api/prompt-templates`, `POST /api/prompt-templates`, `PUT /api/prompt-templates/:id`, `DELETE /api/prompt-templates/:id` — `src/backend/routes/templates.ts`
- Fetcher (email retrieval controller and logs)
  - `GET /api/fetcher/status` — loop active/running timestamps
  - `POST /api/fetcher/start`, `POST /api/fetcher/stop` — toggles and persists `fetcherAutoStart`
  - `POST /api/fetcher/fetch` (fire‑and‑forget), `POST /api/fetcher/run` (awaits)
  - `GET /api/fetcher/log` (alias), `GET /api/fetcher/logs`
  - `DELETE /api/fetcher/logs/:id`, `DELETE /api/fetcher/logs` (expects body `{ ids: string[] }`) — via cleanup service
- Diagnostics
  - Unified/provider events and traces under `src/backend/routes/{diagnostics.ts, unified-diagnostics.ts}` (admin/debug). Keep separate from user Results.
- Accounts/Directors/Agents/Filters/Templates/Memory/Conversations
  - Modular files exist under `src/backend/routes/`. See each file for exact shapes.

### Token Refresh (Gmail/Outlook): Re-Auth and Structured Logging

- Endpoints (see `src/backend/routes/accounts.ts`):
  - `POST /api/accounts/:id/refresh` (Gmail/Outlook refresh)
  - `GET /api/accounts/:id/gmail-test` (Gmail API probe)
  - `GET /api/accounts/:id/outlook-test` (Outlook/Microsoft Graph probe)
- On Gmail token errors requiring user action, responses include a re-authorization URL:
  - Shape: `{ ok: false, error: <category>, authorizeUrl: <string> }`
  - Error categories: `missing_refresh_token`, `invalid_grant`, `network`, `other`.
- Structured JSON logs are emitted with timestamp, operation, account id/email, category, and detail. Info events are logged when a re-auth URL is generated and returned.

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
- Orchestration integration: fetchers can trigger orchestration runs via the `runOrchestration` callback.

### Cleanup Service

- Module: `src/backend/services/cleanup.ts`
- Exposes `createCleanupService()` which returns operations to remove logs, conversations, traces, and workspace items by id.
- Backed by a `RepositoryHub` accessor that abstracts underlying persistence.
