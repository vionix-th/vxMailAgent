# Repository Guidelines

> Docs Scope: `docs/DESIGN.md` describes the target/final product and intended behavior; `docs/DEVELOPER.md` covers current implementation, APIs, and ongoing development.

## Project Structure & Module Organization
- Backend: `src/backend/` (Express, TypeScript). Routes in `routes/`, services in `services/`, utils in `utils/`, config in `config.ts`.
- Frontend: `src/frontend/` (React + Vite). App code in `src/frontend/src/`.
- Shared: `src/shared/` (cross‑cutting types and assets like `site-logo.png`).
- Tests: `src/backend/tests/` with integration suites under `integration/*.cjs` driven via the test harness.

## Build, Test, and Development Commands
- Backend dev: `npm --prefix src/backend run dev` (starts Express via ts-node).
- Backend build: `npm --prefix src/backend run build` → `dist/`; start: `npm --prefix src/backend run start`.
- Backend quality: `npm --prefix src/backend run lint` • `typecheck` • `check`.
- Frontend dev: `npm --prefix src/frontend run dev` • build: `npm --prefix src/frontend run build` • preview: `npm --prefix src/frontend run preview`.
- Integration tests: `node --test --test-reporter=spec src/backend/tests/integration/*.cjs` (requires prior backend build).

## Coding Style & Naming Conventions
- Language: TypeScript strict. Use `??` only for truly optional, typed fields; never default invariants with `||` or `??`.
- Indentation: 2 spaces; files `kebab-case.ts`; types `PascalCase`; functions/vars `camelCase`; env `UPPER_SNAKE`.
- Lint: `src/backend/eslint.config.cjs` enforces error handling and bans direct thread mutations (use `services/conversation-mutations.ts`). Fix warnings before commit.

## Type Purity & Invariants (Authoritative)
- Domain vs Diagnostics: Domain models must never embed diagnostics or tracing fields (no `traceId`, `spanId`, provider events). Diagnostics reference domain by id (e.g., `conversationId`, `runId`, `accountId`) — not the other way around.
- Run Identity: Use `runId` (required) to correlate orchestration steps; avoid legacy names like `fetchCycleId` in new code.
- Required-by-Default: Prefer required fields. Optional fields must be justified, documented inline, and covered by tests. Collections are empty arrays (`[]`), not `undefined`.
- No Defaults for Invariants: Never mask required identifiers with fallbacks (e.g., `|| ''`, `|| 'unknown'`, `x ?? ''`). Validate and fail fast. Do not convert `||`→`??` while keeping the same default on invariants.
- Discriminated Unions: Tool payloads and results use action/flag discriminants (e.g., calendar `read` vs `add`) so the type system enforces runtime rules.
- Tool Metadata: `ToolFlags` fields (`mandatory`, `directorOnly`) are required booleans; `ToolDescriptor.inputSchema` and `ToolDescriptor.flags` are required.
- Secrets Separation: Shared/front-end visible types must not expose secrets (e.g., `apiKey`, OAuth tokens). Define public DTOs at route boundaries (e.g., Settings `apiConfigs` omits keys) and keep secret-bearing types backend-only.
  - Engine boundary: call `conversationEngine.run(input, { apiKey })`. Do not embed secrets in `input` (context/messages/apiConfig). Missing keys must throw.
  - Tool exposure: Directors and Agents share the same tools except those marked `directorOnly` in the registry (e.g., `delegate_to_agent`). Do not add role-specific filters elsewhere.

### PR Checklist (Types & Contracts)
- No diagnostic fields in domain type
- No invariant fallbacks: search `rg -n "\|\|\s*''|\|\|\s*\"\"|\?\?\s*['\"]|String\(.*\|\||String\(.*\?\?" src`.
- Required arrays (no `?: string[]`) for capability lists; empty arrays used when none.
- Tool payloads/results are discriminated unions; validators align with types.
- Public route DTOs exclude secret fields (settings/accounts). Review `routes/settings.ts` and similar.

## Testing Guidelines
- Framework: Node’s test runner (`node --test`) with the backend test harness (`src/backend/tests/lib`).
- Conventions: Use integration suites under `src/backend/tests/integration/*.cjs` to cover HTTP surfaces and orchestration flows.
- Harness usage: Prefer `withServer(async ({ baseUrl }) => { ... })` over manual lifecycle. Use `createSession()` to authenticate and `createLogCapture()` to assert structured logs.
- Auth: Avoid hand‑rolled JWTs in tests; the harness discovers a `.testuser` and creates a session via `/api/test/session`.
- Deterministic env switches are applied by the harness (see its README): mock mail provider, disabled orchestrator during ingestion, and OpenAI stub for prompt‑assist.

### Backend Test Strategy & Invariants (Authoritative)
- Scope: Integration suites validate core invariants through HTTP against the compiled server (`dist/`).
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
- Build first: `cd src/backend && npm run build`.
- Run: `node --test --test-reporter=spec src/backend/tests/integration/*.cjs`.
- The harness sets test‑only env toggles internally; no manual env required.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `security:`). Keep scope focused.
- PRs: include purpose, linked issues, testing notes (commands + outcomes), screenshots for UI, and security considerations if touching auth/persistence.
- Gates: lint + typecheck + tests must pass. No silent defaults for required config; fail fast with clear errors.

## Security & Configuration
- At-rest encryption relies on SQLCipher/SEE builds; no application-level key is consumed.
- Do not log secrets. Validate external inputs at boundaries. Follow `docs/DESIGN.md` principles and root `AGENTS.md` coding discipline.
