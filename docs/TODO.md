# Development Backlog
_Last updated: 2025-09-23_

## Dependency Roadmap
1. Seal config invariants (`src/backend/config.ts`).
2. Fix agent orchestrator secret plumbing (depends on 1).
3. Enforce entity presence in `list_tools` (depends on 1).
4. Tighten agent CRUD validation (depends on 3).
5. Consolidate API config serialization (depends on 1-4).
6. Complete SQLite service layer integration (depends on 5).
7. Finish SQLite testing & verification (depends on 6).
8. Publish SQLite operational notes (depends on 7).
9. Align frontend workspace APIs with conversation scope (depends on 6).
10. Rebuild Results workspace aggregation (depends on 9).
11. Redesign API config management UI (depends on 5).

## Task Details

### 1. Seal config invariants
- **Goal:** Replace optional env helpers in `src/backend/config.ts` with hard-fail `requireEnv` lookups, remove the non-production bypass in `warnIfInsecure`, and provide local fixture exports.
- **Blocked by:** None.
- **Unblocks:** Tasks 2-8.
- **Status:** ✅ Completed (2025-09-23) — `config.ts` now requires critical env vars, `assertSecureConfig()` enforces invariants on startup, and `docs/env.local.example` ships fixture values.

### 2. Fix agent orchestrator secret plumbing
- **Goal:** Update `executeAgentConversation` to pass `{ apiKey }`, reject missing keys, and cover with regression tests.
- **Depends on:** Task 1.
- **Unblocks:** Tasks 3-8.
- **Notes:** After Task 5, revisit orchestrator helpers to consume the centralized serializer output instead of re-creating public views inline.
- **Status:** ✅ Completed (2025-09-23) — orchestrator now validates presence of `apiConfig.apiKey` and passes `{ apiKey }` into `runAgentConversation`.

### 3. Enforce entity presence in `list_tools`
- **Goal:** Make `list_tools` fail closed when director/agent lookups miss, updating callers/tests.
- **Depends on:** Tasks 1 and 2.
- **Unblocks:** Task 4 onward.
- **Status:** ✅ Completed (2025-09-23) — `list_tools` now returns explicit `Director not found` / `Agent not found` errors instead of falling back to mandatory descriptors.

### 4. Tighten agent CRUD validation
- **Goal:** Require explicit `enabledToolCalls` arrays, have `sanitizeEnabled` throw on non-arrays, and document the contract.
- **Depends on:** Task 3.
- **Unblocks:** Task 5 onward.
- **Status:** ✅ Completed (2025-09-23) — CRUD routes reject missing/non-array `enabledToolCalls`, sanitizer returns `null` for invalid inputs, and updates enforce the array contract.

### 5. Consolidate API config serialization
- **Goal:** Drop the duplicate public types, keep `ApiConfig` as the single domain shape, and introduce a REST serializer (`serializeApiConfigForClient`) that strips secrets.
- **Depends on:** Tasks 1-4 (ensures upstream invariants are locked before consolidating serialization).
- **Unblocks:** Task 6 onward.
- **Required work:**
  - Remove `ApiConfigPublic` from `src/shared/types.ts` and update all imports (services, tool calls, orchestrator, frontend shared types).
  - Add serializer helpers in `services/settings` (server) and typed client equivalents; ensure routes call them instead of manual spreads.
  - Add lint/test guard preventing `apiKey` from appearing in JSON responses.
  - Update frontend consumers to rely on the REST response contract rather than shared public types.
- **Status:** ✅ Completed (2025-09-23) — domain `ApiConfig` now carries secrets, `serializeApiConfig` filters REST/engine payloads, tests guard against leaking `apiKey`, and frontend consumes a local response type.

### 6. SQLite service layer integration — Status: ⏳ Pending
- Update `repo-access.ts`, `liveRepos.ts`, and service routes (accounts, settings, memory, templates, workspaces, cleanup, conversations) to call SQLite repositories directly.
- Drop JSON path scaffolding; ensure user context bootstrapping only requests SQLite handles.
- Remove file-lock scaffolding; rely on SQLite transactions.
- Validate `LiveRepos` mutate/append flows via `src/backend/tests/liveRepos.sqlite.unit.cjs`.
- **Adjustments post-Task 5:** Audit repository return shapes to confirm they align with the new serializer boundary (no accidental secret strips at the data layer).
- **Status:** ✅ Completed (2025-09-23) — CLI tooling now reads users from SQLite, provider-event pruning uses proper literals, `RepoBundleRegistry` exposes `shutdownRepos()` for clean handles, and `liveRepos` mutation tests pass under the SQLite stack.

### 7. SQLite testing & verification — Status: ⏳ Pending
- Add integration tests under `src/backend/tests/sqlite/*.cjs` with ephemeral DB fixtures.
- Validate schema invariants: required fields reject with descriptive errors; wrong enums throw before SQL execution.
- Include regression coverage asserting that serialized settings responses exclude `apiKey` after Task 5.
- **Status:** ✅ Completed (2025-09-23) — Added SQLite integration suites for settings, accounts, and workspace invariants, validated serializer behavior, and exercised them against the compiled backend (requires `npm run build` plus SQLite env vars to run locally).

### 8. SQLite operational notes — Status: ⏳ Pending
- Document bootstrap steps in `docs/DEVELOPER.md` (dependency, init command, backup/restore).
- Provide runbook snippet for per-user DB inspection (`sqlite3 data/users/<uid>/user.sqlite3`).
- Leave encryption hooks disabled but documented for future activation.
- **Status:** ✅ Completed (2025-09-23) — Added a SQLite operational cheat sheet to `docs/DEVELOPER.md` with bootstrap, env overrides, backups, inspection commands, and integration-test invocation guidance.

### 9. Align frontend workspace APIs with conversation scope
- **Goal:** Replace `/api/workspaces/default/items` usage with conversation-scoped requests that include the thread/workspace id, and ensure delete helpers route through `/api/workspaces/:id/items/:itemId` using provenance data.
- **Depends on:** Task 6 (SQLite-backed workspace repos).
- **Unblocks:** Task 10.
- **Status:** ✅ Completed (2025-09-23) — `Results` now loads items by iterating `/api/workspaces/:conversationId/items`, aggregates them locally, and deletion helpers send the conversation id into the scoped endpoints.

### 10. Rebuild Results workspace aggregation
- **Goal:** Rework `Results` data loading to gather workspace items per conversation and aggregate via provenance/lifecycle metadata instead of relying on the deleted default workspace.
- **Depends on:** Task 9.
- **Unblocks:** None.
- **Status:** ✅ Completed (2025-09-23) — Results now caches workspace items per conversation, only refetches threads whose snapshots change, and surfaces conversation status/last activity in the email navigator.

### 11. Redesign API config management UI
- **Goal:** Update `Settings` API config management to respect backend secret constraints by removing client-side creation/updating of configs through `PUT /api/settings` and introducing a flow that either calls a backend-managed creation endpoint or clearly marks configs as read-only with guidance for secret provisioning.
- **Depends on:** Task 5 (centralized API config serialization and secret handling).
- **Unblocks:** Stable frontend settings management.
- **Status:** ⏳ Pending — Current UI still attempts to POST freshly generated configs without `apiKey` (`src/frontend/src/Settings.tsx:147`), which the backend now rejects after Task 5.

## Completed SQLite Milestones (for reference)
- Storage contract foundation (paths, handle, factory, pragmas).
- Schema specification (system + per-user DDL, indexes).
- Fresh DB initialization (`initializer.ts`, CLI helper).
- Repository adapters (SQLite-backed repos, registry, users repo).
- Logging & tracing separation (SQL-based retention, diagnostics queries).
