# Development Backlog
_Last updated: 2025-09-22_

## Dependency Roadmap
1. Seal config invariants (`src/backend/config.ts`).
2. Fix agent orchestrator secret plumbing (depends on 1).
3. Enforce entity presence in `list_tools` (depends on 1).
4. Tighten agent CRUD validation (depends on 3).
5. Consolidate API config serialization (depends on 1-4).
6. Complete SQLite service layer integration (depends on 5).
7. Finish SQLite testing & verification (depends on 6).
8. Publish SQLite operational notes (depends on 7).

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

### 7. SQLite testing & verification — Status: ⏳ Pending
- Add integration tests under `src/backend/tests/sqlite/*.cjs` with ephemeral DB fixtures.
- Validate schema invariants: required fields reject with descriptive errors; wrong enums throw before SQL execution.
- Include regression coverage asserting that serialized settings responses exclude `apiKey` after Task 5.

### 8. SQLite operational notes — Status: ⏳ Pending
- Document bootstrap steps in `docs/DEVELOPER.md` (dependency, init command, backup/restore).
- Provide runbook snippet for per-user DB inspection (`sqlite3 data/users/<uid>/user.sqlite3`).
- Leave encryption hooks disabled but documented for future activation.

## Completed SQLite Milestones (for reference)
- Storage contract foundation (paths, handle, factory, pragmas).
- Schema specification (system + per-user DDL, indexes).
- Fresh DB initialization (`initializer.ts`, CLI helper).
- Repository adapters (SQLite-backed repos, registry, users repo).
- Logging & tracing separation (SQL-based retention, diagnostics queries).
