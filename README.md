# vxMailAgent

Email assistant that fetches Gmail/Outlook mail, routes messages through a director + agents orchestration powered by OpenAI, and presents results in a React UI. Configuration and runtime data are stored under `data/` and can be encrypted at rest.

## Quick Start

- Prereqs: Node.js 18+, npm, browser.
- Terminals: run backend and frontend in separate shells.

Backend (`src/backend`)
- `cp .env.example .env` and fill required secrets (see Env Vars).
- `npm install`
- `npm run dev` (listens on `http://localhost:3001` by default)
- Validate: `GET http://localhost:3001/api/health` returns `{"status":"ok"}`

Frontend (`src/frontend`)
- `npm install`
- `npm run dev` (Vite dev server on `http://localhost:3000`, proxies `/api` → `http://localhost:3001`)
- Open `http://localhost:3000`

Note: The Vite dev server is configured for port `3000` in `src/frontend/vite.config.ts`.

## Project Structure

- `src/backend`: Express API (OAuth, persistence, orchestration). Entry: `index.ts`
- `src/frontend`: Vite + React UI (Material‑UI + Tailwind)
- `src/shared`: Cross‑package TypeScript types used by backend and frontend
- `docs/DEVELOPER.md`: API details and developer notes; `DESIGN.md` for architecture context
- `data/`: Local runtime store (accounts, prompts, logs, etc.)

## Environment Variables (Backend)

- `VX_MAILAGENT_KEY` — required for encryption: 64‑char hex key to encrypt `data/` at rest. If missing/invalid, data is written in plaintext (dev‑only).
- Google OAuth2 (Provider accounts: Gmail/Calendar/Tasks)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI` → set to `http://localhost:3001/api/accounts/oauth/google/callback` (backend callback)
- Google OAuth2 (App Login: OIDC session)
  - `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`
  - `GOOGLE_LOGIN_REDIRECT_URI` → set to `http://localhost:3001/api/auth/google/callback` in local dev (backend receives code)
- Outlook OAuth2:
  - `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`
  - `OUTLOOK_REDIRECT_URI` → set to `http://localhost:3001/api/accounts/oauth/outlook/callback` (backend callback)
- OAuth state signing:
  - `JWT_SECRET` — used to sign login session tokens and short‑lived OAuth state tokens for `/api/accounts/oauth/*` flows.
  - `JWT_EXPIRES_IN_SEC` — session token TTL (default 86400 seconds).
- Optional:
  - `PORT` → backend port (default `3001`)
  - `VX_MAILAGENT_DATA_DIR` → override `data/` path (absolute or relative to process cwd). See resolution in `src/backend/utils/paths.ts`.
  - `CORS_ORIGIN` → allowed frontend origin for CORS (default `*`)
  - Logging: `LOG_LEVEL` (default `debug` in dev, `info` in prod), `NODE_ENV`
  - Diagnostics/Tracing: `TRACE_PERSIST`, `TRACE_VERBOSE`, `TRACE_MAX_PAYLOAD`, `TRACE_MAX_SPANS`, `TRACE_MAX_TRACES`, `TRACE_TTL_DAYS`, `TRACE_REDACT_FIELDS`
  - Retention: `PROVIDER_MAX_EVENTS`, `PROVIDER_TTL_DAYS`, `FETCHER_TTL_DAYS`, `ORCHESTRATION_TTL_DAYS`
  - Timeouts (ms): `OPENAI_REQUEST_TIMEOUT_MS`, `GRAPH_REQUEST_TIMEOUT_MS`, `PROVIDER_REQUEST_TIMEOUT_MS`, `CONVERSATION_STEP_TIMEOUT_MS`, `TOOL_EXEC_TIMEOUT_MS`
  - Multi‑user limits: `USER_REGISTRY_TTL_MINUTES`, `USER_REGISTRY_MAX_ENTRIES`, `USER_MAX_FILE_SIZE_MB`, `USER_MAX_CONVERSATIONS`, `USER_MAX_LOGS_PER_TYPE`, `FETCHER_MANAGER_TTL_MINUTES`, `FETCHER_MANAGER_MAX_FETCHERS`

Note: OpenAI API keys are configured per user in Settings and stored securely. There is no required global `OPENAI_API_KEY` environment variable in production use.

Use `src/backend/.env.example` as a template.

## Authentication (Login)

- The app uses a stateless session backed by a signed JWT stored in an HttpOnly cookie `vx.session`.
- Endpoints:
  - `GET /api/auth/google/initiate` → returns a Google OAuth2 authorization URL (scopes: `openid email profile`).
  - `GET /api/auth/google/callback?code=...&state=...` → exchanges the code, upserts the user, and sets the `vx.session` cookie.
  - `GET /api/auth/whoami` → returns `{ user }` when authenticated, or HTTP 401.
  - `POST /api/auth/logout` → clears the `vx.session` cookie and ends the session.
- Route guard: Almost all API routes are protected by `requireAuth`. Public allowlist: `/api/auth/*`, `/api/auth/whoami`, `/api/health`.
  - Per-user provider OAuth endpoints under `/api/accounts/oauth/*` (Google/Outlook) are protected by `requireAuth`. Linking provider accounts requires an authenticated session.
  - Cookie flags: `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
  
Note: Login OAuth uses a separate Google OAuth client from provider accounts to prevent refresh token rotation/invalidation when the same Google user is used for both flows.

## Development Commands

Backend (`src/backend`)
- `npm run dev`: start API with ts‑node
- `npm run build`: type‑check and emit JS to `dist/`
- `npm run generate-testdata`: seed local `data/` with sample objects

Frontend (`src/frontend`)
- `npm run dev`: start Vite dev server (proxies `/api`)
- `npm run build` / `npm run preview`: build and locally preview production assets

## Data & Security

**CRITICAL**: Strict per-user data isolation enforced throughout the system.

- **Storage**: JSON files under `data/users/{uid}/` (per-user isolation). Examples within a user root: `accounts.json`, `directors.json`, `conversations.json`, `workspaceItems.json`, and `logs/{fetcher,orchestration,provider-events,traces}.json`.
- **Global Data Restriction**: Only `data/users.json` contains global application data (user registry for login). This file is NOT exposed via UI or APIs.
- **User Context Required**: All data access requires authenticated user context. No global fallbacks exist to prevent data leakage between users.
- **Encryption**: AES‑256‑GCM with random IV; enabled when `VX_MAILAGENT_KEY` is a valid 64‑char hex. When not set, files are plaintext JSON for development convenience.
- **Secrets**: never commit `.env` or tokens. Use the example template and export env vars locally.

## OAuth Flow (Gmail/Outlook)

- From the UI, start an OAuth flow → provider redirects to `http://localhost:3000/oauth/callback` (handled by `src/frontend/src/OAuthCallback.tsx`).
- The frontend calls `/api/accounts/oauth/{google|outlook}/callback` to exchange the `code`. The backend verifies the JWT‑signed state, exchanges tokens, persists the account for the authenticated user, and returns the created/updated `account` JSON. No additional POST is required.
- If a Gmail/Outlook refresh token is missing/invalid (e.g., after revocation), backend endpoints may respond with an `authorizeUrl` for re-auth. The UI should redirect the user to that URL to restore tokens.
- To verify provider access in development, call `GET /api/accounts/:id/gmail-test` or `GET /api/accounts/:id/outlook-test`.

## API Overview (Implemented)

- **Health**
  - `GET /api/health`
- **Auth (Login session)**
  - `GET /api/auth/google/initiate`
  - `GET /api/auth/google/callback`
  - `GET /api/auth/whoami`
  - `POST /api/auth/logout`
- **Accounts** (`gmail`/`outlook`)
  - `GET /api/accounts`
  - `POST /api/accounts`
  - `PUT /api/accounts/:id`
  - `DELETE /api/accounts/:id`
  - `POST /api/accounts/:id/refresh`
  - `GET /api/accounts/:id/gmail-test`
  - `GET /api/accounts/:id/outlook-test`
- **Settings**
  - `GET /api/settings`
  - `PUT /api/settings`
- **Prompts**
  - `GET /api/prompts`, `POST /api/prompts`, `PUT /api/prompts/:id`, `DELETE /api/prompts/:id`
  - `POST /api/prompts/assist`
- **Prompt Templates**
  - `GET /api/prompt-templates`, `POST /api/prompt-templates`, `PUT /api/prompt-templates/:id`, `DELETE /api/prompt-templates/:id`
- **Directors / Agents / Filters / Imprints**
  - `GET/POST/PUT/DELETE /api/directors[...]`
  - `GET/POST/PUT/DELETE /api/agents[...]`
  - `GET/POST/PUT/DELETE /api/filters[...]` + `PUT /api/filters/reorder`
  - `GET/POST/PUT/DELETE /api/imprints[...]`
- **Conversations**
  - `GET /api/conversations`, `GET /api/conversations/:id`
  - `GET /api/conversations/byDirectorEmail?directorId=&emailId=`
  - `POST /api/conversations/:id/messages`
  - `POST /api/conversations/:id/assistant`
  - `DELETE /api/conversations/:id`
  - `DELETE /api/conversations` (bulk; body `{ ids: string[] }`)
- **Workspaces** (no create via REST)
  - `GET /api/workspaces/:id/items`
  - `GET /api/workspaces/:id/items/:itemId`
  - `PUT /api/workspaces/:id/items/:itemId`
  - `DELETE /api/workspaces/:id/items/:itemId[?hard=true]`
- **Memory**
  - `GET /api/memory`, `POST /api/memory`, `PUT /api/memory/:id`, `DELETE /api/memory/:id`, `DELETE /api/memory` (bulk)
- **Fetcher**
  - `GET /api/fetcher/status`, `POST /api/fetcher/start`, `POST /api/fetcher/stop`, `POST /api/fetcher/fetch`, `POST /api/fetcher/run`
  - Logs: `GET /api/fetcher/logs`, `DELETE /api/fetcher/logs/:id`, `DELETE /api/fetcher/logs` (bulk)
- **Diagnostics**
  - Runtime: `GET /api/diagnostics/runtime`
  - Orchestration diagnostics: `GET /api/orchestration/diagnostics`, `DELETE /api/orchestration/diagnostics/:id`, `DELETE /api/orchestration/diagnostics` (bulk)
  - Unified tree: `GET /api/diagnostics/unified`, `GET /api/diagnostics/unified/:nodeId`
- **Cleanup (admin)**
  - `GET /api/cleanup/stats`, `DELETE /api/cleanup/all`, plus category deletes under `/api/cleanup/*`
  - For fetcher logs full purge, use: `DELETE /api/cleanup/fetcher-logs` (canonical)

See `docs/DEVELOPER.md` for details.

## UI Overview

- Results (Workspace): user‑facing deliverables for processed emails
- Memory: global/shared/local knowledge management
- Prompts: system/user/assistant messages; optimizer endpoint available
- Directors / Agents: orchestration roles and provider configs
- Filters: regex routing rules for incoming emails
- Admin Console: diagnostics, fetcher control, health

## Operational Notes

- **Isolation & encryption**: Strict per‑user data isolation. AES‑256‑GCM at rest when `VX_MAILAGENT_KEY` is a valid 64‑char hex. See `docs/DEVELOPER.md`.
- **CORS (dev)**: `cors()` is permissive for local dev. In production, restrict origins or co‑host UI and API.
- **Env & secrets**: Load via `.env`; do not commit secrets. Tokens are never logged.
- **Data dir**: `VX_MAILAGENT_DATA_DIR` overrides `data/` location. Ensure write permissions.
- **OAuth pattern**: Frontend receives `code` → calls backend callbacks. Redirect URIs should point to `/oauth/callback` on the frontend for provider accounts; login callback handled by backend.
- **Tokens in responses**: Account linking responses include tokens for client‑side persistence in dev. For multi‑user/remote deployments, persist tokens only server‑side and avoid exposing to the browser.
- **Diagnostics visibility**: Provider/orchestration logs may contain sensitive content; surface only in admin views.
- **Production hardening**: Enforce HTTPS, HSTS, strict CORS. Note: CSRF protection and rate limiting are not implemented in the backend; enforce them at a reverse proxy/API gateway or add Express middleware per deployment needs. Session cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` (prod), which mitigates CSRF for same-site deployments.
- **Request validation**: No global validation middleware. A minimal JSON Schema subset validator exists in `src/backend/validation.ts` and is used only by tool-call handlers in `src/backend/toolCalls.ts` to validate tool parameters. Other routes rely on path safety and user-context checks. See `docs/DEVELOPER.md` and `docs/DESIGN.md` for details.

## Troubleshooting

- Health check: `GET /api/health` (backend must be running)
- OAuth redirect mismatch: confirm provider console redirect URIs are `http://localhost:3000/oauth/callback`
- Data path issues: set `VX_MAILAGENT_DATA_DIR` to an absolute path and ensure the process has write permissions
- Encryption key errors: ensure `VX_MAILAGENT_KEY` is exactly 64 hex characters
- Proxy issues: frontend requests to `/api` should reach the backend at `http://localhost:3001` (see `src/frontend/vite.config.ts`)

## Contributing

- TypeScript strict mode across packages; follow the existing two‑space indent and single quotes.
- Conventional Commits (e.g., `feat(backend): add Outlook OAuth refresh`).
- Before PRs: run `npm run build` in both `src/backend` and `src/frontend` to type‑check.

