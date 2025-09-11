# Repository Guidelines

> Docs Scope: `docs/DESIGN.md` describes the target/final product and intended behavior; `docs/DEVELOPER.md` covers current implementation, APIs, and ongoing development.

## Project Structure & Module Organization
- Backend: `src/backend/` (Express, TypeScript). Routes in `routes/`, services in `services/`, utils in `utils/`, config in `config.ts`.
- Frontend: `src/frontend/` (React + Vite). App code in `src/frontend/src/`.
- Shared: `src/shared/` (cross‑cutting types and assets like `site-logo.png`).
- Tests: `src/backend/tests/` with live (`*.live.cjs`), unit (`*.unit.cjs`), mock (`*.mock.cjs`).

## Build, Test, and Development Commands
- Backend dev: `npm --prefix src/backend run dev` (starts Express via ts-node).
- Backend build: `npm --prefix src/backend run build` → `dist/`; start: `npm --prefix src/backend run start`.
- Backend quality: `npm --prefix src/backend run lint` • `typecheck` • `typecheck:strict` • `check`.
- Frontend dev: `npm --prefix src/frontend run dev` • build: `npm --prefix src/frontend run build` • preview: `npm --prefix src/frontend run preview`.
- Tests: `node src/backend/tests/run-all-tests.cjs`. Live-only: `node --test src/backend/tests/*.live.cjs`.

## Coding Style & Naming Conventions
- Language: TypeScript strict. Use `??` only for typed optionals; never default with `||`.
- Indentation: 2 spaces; files `kebab-case.ts`; types `PascalCase`; functions/vars `camelCase`; env `UPPER_SNAKE`.
- Lint: `src/backend/eslint.config.cjs` enforces error handling and bans direct thread mutations (use `services/conversation-mutations.ts`). Fix warnings before commit.

## Testing Guidelines
- Framework: Node’s test runner (`node --test`) with CJS helpers.
- Conventions: `*.live.cjs`, `*.unit.cjs`, `*.mock.cjs`. Prefer covering routes (CRUD, diagnostics, OAuth) and orchestration flows.
- Authentication: Most `/api/**` routes require auth (health/auth are public). Authenticate via:
  - OAuth (browser): start backend, open `/api/auth/google/initiate`, complete login; cookie `vx.session` is set and reused.
  - Test JWT: sign HS256 JWT with payload `{ uid: '<user-id>' }` using `JWT_SECRET` (default `dev-insecure-jwt`). Send `Authorization: Bearer <token>` or `Cookie: vx.session=<token>`.
    Example (generate and call a protected route):
    `(cd src/backend && TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({uid: process.env.VX_TEST_USER_ID || 'test-user'}, process.env.JWT_SECRET || 'dev-insecure-jwt'))")) && \\
     curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/agents`
- Live env: set `BACKEND_URL`, `JWT_SECRET`, `VX_TEST_USER_ID`; optional `OPENAI_API_KEY` for provider tests. Live tests auto-sign a JWT and pass it as Bearer.

### Backend Test Strategy & Invariants (Authoritative)
- Scope: Unit tests must validate core invariants without HTTP, network, or OAuth. Use compiled modules in `dist/` and minimal in‑memory repos.
- Orchestrator Contract:
  - For every assistant `tool_calls[]`, there MUST be exactly one `tool` reply per `tool_call_id` in the same cycle.
  - Dynamic agent delegation uses the `agent__<id>` naming convention; missing/unknown agents must produce a `tool` error reply and log a contract‑violation event.
  - Director/Agent must fail fast with descriptive errors for invalid `apiConfigId` or missing prompts.
- Logging Semantics:
  - Orchestration and Provider logs MUST append atomically via repository `.append()`; read+set is banned in tests and code.
  - Concurrency: appending N entries from concurrent tasks yields +N entries.
- Repo & Paths:
  - `userPaths()` produces safe, per‑user files; `validatePathSafety()` contains paths under user root.
  - Pruning honors TTL and maxItems caps (keep latest by list order).
- Configuration Guards:
  - Required OAuth/env must use fail‑fast helpers (e.g., `getGoogleOAuthConfig()`); tests cover both failure and success paths.

### Test Commands & Environment
- Deterministic env for tests:
  - `VX_TEST_MOCK_OPENAI=true` to avoid network calls and make the engine deterministic.
  - `TRACE_PERSIST=false` for unit tests (enable selectively when testing traces).
  - Optionally set `VX_MAILAGENT_DATA_DIR` to a temp dir for FS-backed tests.
- Scripts (from `src/backend/package.json`):
  - `npm run test:unit` — build + unit tests (no HTTP); uses `--test-timeout=90000 --test-concurrency=1`.
  - `npm run test:unit:compiled` — run unit tests against already built `dist/`.
  - `npm run test:contract` — build + orchestrator contract test (monkey‑patched engine; no network).
  - `npm run test:contract:compiled` — run contract test against already built `dist/`.
  - `npm run test:live` — optional live route tests (requires backend running and auth token).
- Guidance to avoid hangs:
  - Do not start servers, background loops, or long intervals in unit tests.
  - Avoid FS hot loops; prefer in‑memory repos. If FS is needed, use a temp `VX_MAILAGENT_DATA_DIR` and clean up.
  - Default test timeout is 90s; anything longer is considered a design issue. Five‑minute timeouts are prohibited.
  - Disable dotenv in tests with `DISABLE_DOTENV=true` to prevent `.env` interference.

### Coverage Expectations
- Target: 100% backend coverage on core modules. Prioritize:
  - `services/`: conversation‑orchestrator (contract + error), orchestration‑agent, email‑processor, email‑fetcher, fetcher‑manager, workspace‑service, logging (+ traces), logging‑handlers.
  - `repository/`: pruning utilities, file repositories basic read/write with TTL/maxItems.
  - `utils/`: paths (uid safety + containment), orchestration helpers, id/session helpers where feasible.
- Tooling: prefer `c8` for coverage. Suggested script:
  - `test:cov`: `c8 --reporter=text-summary node --test "tests/*unit.cjs" "tests/orchestrator.contract.cjs"` with `VX_TEST_MOCK_OPENAI=true TRACE_PERSIST=false`.
- Gates: CI runs `check` (lint+types+build) then unit + contract tests. Coverage thresholds may be enforced in CI.

### Do/Don’t for Tests
- Do: use compiled modules from `dist/backend/*`; isolate with in‑memory repos and minimal `ReqLike`.
- Do: explicitly assert error messages for invalid config; assert append counts for logging.
- Don’t: depend on external OAuth/providers in unit tests; don’t rely on read+set logging.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `security:`). Keep scope focused.
- PRs: include purpose, linked issues, testing notes (commands + outcomes), screenshots for UI, and security considerations if touching auth/persistence.
- Gates: lint + typecheck + tests must pass. No silent defaults for required config; fail fast with clear errors.

## Security & Configuration
- Encryption key: export `VX_MAILAGENT_KEY` (64‑char hex) for at‑rest encryption.
- Do not log secrets. Validate external inputs at boundaries. Follow `docs/DESIGN.md` principles and root `AGENTS.md` coding discipline.
