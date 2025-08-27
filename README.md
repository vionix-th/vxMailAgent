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
- `docs/DEVELOPER.md`: API details and developer notes; `Design.md` for architecture context
- `data/`: Local runtime store (accounts, prompts, logs, etc.)

## Environment Variables (Backend)

- `VX_MAILAGENT_KEY` — required for encryption: 64‑char hex key to encrypt `data/` at rest. If missing/invalid, data is written in plaintext (dev‑only).
- `OPENAI_API_KEY` (required): OpenAI API key for orchestration.
- Google OAuth2 (Provider accounts: Gmail/Calendar/Tasks)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI` → set to `http://localhost:3000/oauth/callback` (frontend receives code)
- Google OAuth2 (App Login: OIDC session)
  - `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`
  - `GOOGLE_LOGIN_REDIRECT_URI` → set to `http://localhost:3001/api/auth/google/callback` in local dev (backend receives code)
- Outlook OAuth2:
  - `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`
  - `OUTLOOK_REDIRECT_URI` → set to `http://localhost:3000/oauth/callback`
- Optional:
  - `PORT` → backend port (default `3001`)
  - `VX_MAILAGENT_DATA_DIR` → override `data/` path (absolute or relative to process cwd)

Use `src/backend/.env.example` as a template.

## Authentication (Login)

- The app uses a stateless session backed by a signed JWT stored in an HttpOnly cookie `vx.session`.
- Endpoints:
  - `GET /api/auth/google/initiate` → returns a Google OAuth2 authorization URL (scopes: `openid email profile`).
  - `GET /api/auth/google/callback?code=...&state=...` → exchanges the code, upserts the user, and sets the `vx.session` cookie.
  - `GET /api/auth/whoami` → returns `{ user }` when authenticated, or HTTP 401.
  - `POST /api/auth/logout` → clears the `vx.session` cookie and ends the session.
- Route guard: Almost all API routes are protected by `requireAuth`. Public allowlist: `/api/auth/*`, `/api/auth/whoami`, `/api/health`.
  - Provider OAuth endpoints under `/api/oauth2/*` (Google/Outlook) are protected by `requireAuth`. Linking provider accounts requires an authenticated session.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Production hardening: in production, HTTP is redirected to HTTPS and HSTS is set (`Strict-Transport-Security: max-age=31536000; includeSubDomains`).
  
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

- Storage: JSON files under `data/` (e.g., `accounts.json`, `directors.json`, `orchestrationConversations.json`).
- Encryption: AES‑256‑GCM with random IV; enabled when `VX_MAILAGENT_KEY` is a valid 64‑char hex. When not set, files are plaintext JSON for development convenience.
- Secrets: never commit `.env` or tokens. Use the example template and export env vars locally.

## OAuth Flow (Gmail/Outlook)

- From the UI, start an OAuth flow → provider redirects to `http://localhost:3000/oauth/callback` (handled by `src/frontend/src/OAuthCallback.tsx`).
- The frontend exchanges the `code` with the backend via `/api/oauth2/{google|outlook}/callback` to produce an `account` object, then persists it via `POST /api/accounts`.
- If a Gmail/Outlook refresh token is missing/invalid (e.g., after revocation), backend endpoints may respond with an `authorizeUrl` for re-auth. The UI should redirect the user to that URL to restore tokens.
- To verify provider access in development, call `GET /api/accounts/:id/gmail-test` or `GET /api/accounts/:id/outlook-test`.

## API Overview

- Health: `GET /api/health`
- Auth session: `/api/auth/google/initiate`, `/api/auth/google/callback`, `/api/auth/whoami`, `/api/auth/logout`
- OAuth: `/api/oauth2/google|outlook/{initiate,callback}` (requires authentication)
- Accounts: `GET/POST/PUT/DELETE /api/accounts[...]` (see `src/backend/routes/accounts.ts`)
- Fetcher: status/start/stop/run/logs under `/api/fetcher` (see `src/backend/routes/fetcher.ts`)
- Orchestration, prompts, agents, directors, conversations, templates, memory, diagnostics, workspaces: modular route files under `src/backend/routes/`
- Types: shared request/response models in `src/shared/types.ts`
- More details: `docs/DEVELOPER.md`

## UI Overview

- Results (Workspace): user‑facing deliverables for processed emails
- Memory: global/shared/local knowledge management
- Prompts: system/user/assistant messages; optimizer endpoint available
- Directors / Agents: orchestration roles and provider configs
- Filters: regex routing rules for incoming emails
- Admin Console: diagnostics, fetcher control, health

## Code Audit

- CORS policy: `cors()` is wide‑open for dev. For production, restrict origins or serve the frontend from the same origin to avoid permissive CORS.
- Secrets handling: `.env` is loaded via `dotenv`; tokens are not logged. Ensure environment is set securely when deploying.
- Data encryption: AES‑256‑GCM implemented in `src/backend/persistence.ts`. Filenames do not include a `.enc` suffix even when encrypted — this is by design; document this for operators.
- Data directory: `VX_MAILAGENT_DATA_DIR` overrides are supported. Fallbacks resolve to repo `data/` for both ts‑node and compiled runs.
- OAuth callback pattern: Frontend receives `code` then calls backend callbacks; redirect URIs should point to the frontend (`/oauth/callback`) as in `.env.example`.
- Token exposure: Backend callback responses include access/refresh tokens in the returned `account` object (so the frontend can persist via `/api/accounts`). For multi‑user or remote deployments, handle token persistence entirely in the backend to avoid exposing tokens to the browser, and scope access controls appropriately.
- OpenAI provider events: Requests/responses are persisted as diagnostics (`ProviderEvent`). Requests do not include the API key; messages and results may include sensitive email content. Only show in admin views.
- Logging: Verbose debug logs in `index.ts` (e.g., module imports). Consider a log level flag and suppress in production.
- Port expectations: Frontend dev server is configured for port `3000` (not Vite’s default `5173`). Docs and env templates reflect 3000; keep consistent.
- Security hardening (prod): consider CSRF/origin checks, rate limiting, and narrowing CORS. Current setup targets local development.

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

