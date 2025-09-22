# SQLite Persistence Refactor
_Last updated: 2025-09-22_

## Status Summary
- **Current phase**: #4 Repository Adapters (complete)
- **Next milestone**: #5 Service Layer Integration

## 0. Preconditions — Status: ✅ Completed
- [x] Audit existing JSON persistence stack (`src/backend/repository/fileRepositories.ts`, `persistence.ts`, `liveRepos.ts`, `user-context.ts`).
- [x] Confirm environment: Node.js (CommonJS) with TypeScript 5.7, Express, Pino logging, per-user data under `data/users/*`).
- [x] Accept scope: no legacy JSON migration, no transitional dual-write, encryption deferred.

## 1. Storage Contract Foundation — Status: ✅ Completed
- [x] Create `src/backend/storage/sqlite/paths.ts` to derive per-user/shared database file locations from existing `userPaths` logic without exporting raw file paths to callers.
- [x] Define `StorageHandle` interface (open/close/transaction helpers) and `SqliteFactory` responsible for serialized connection creation per database file.
- [x] Enforce initialization sequence: `resolveDataDir` → ensure directories (`0o700`) → open SQLite file with `better-sqlite3` constructor.
- [x] Apply connection pragmas once per handle: `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`.

## 2. Schema Specification — Status: ✅ Completed
- [x] Author shared schema DDL (`src/backend/storage/sqlite/schema/system.sql`) defining the canonical `users` table with primary key + unique email constraint.
- [x] Author per-user schema DDL (`src/backend/storage/sqlite/schema/per_user.sql`) covering accounts, configuration, conversations (threads + messages with embedded email JSON), logs, traces, memory, workspace, and emails.
- [x] Add covering indexes for high-frequency lookups (timestamps, conversation/thread ids, scopes, provider filters).

## 3. Fresh DB Initialization — Status: ✅ Completed
- [x] Provide schema initializer (`src/backend/storage/sqlite/initializer.ts`) that applies DDL to brand-new databases and stamps `PRAGMA user_version = 1`.
- [x] Integrate initializer into `SqliteConnectionFactory` so first open of a new file auto-applies the schema.
- [x] Add CLI helper `scripts/sqlite-init.ts` for pre-creating empty SQLite files (shared or per user) without touching legacy JSON blobs.

## 4. Repository Adapters — Status: ✅ Completed
- [x] Implement SQLite-backed repositories for all domain data (`accounts`, `settings`, `prompts`, `agents`, `directors`, `filters`, `templates`, `imprints`, `workspaceItems`, `emails`, `memory`, `conversations` with message storage, `providerEvents`, `fetcherLogs`, `orchestrationLogs`, `traces`).
- [x] Replace file-based `RepoBundle` assembly with SQLite-backed `RepoBundleRegistry`, injecting a shared `SqliteConnectionFactory` and enforcing default settings/templates via SQL.
- [x] Provide a system-level users repository (`SystemUsersRepository`) to replace the JSON `users.json` source of truth.

## 5. Service Layer Integration — Status: ⏳ Pending
- [x] Update `repo-access.ts`, `liveRepos.ts`, and service routes (`accounts`, `settings`, `memory`, `templates`, `workspaces`, `cleanup`, `conversations`) to call SQLite repositories directly without JSON helpers.
- [x] Drop JSON path scaffolding once no consumer depends on it; ensure user context bootstrapping only requests SQLite handles.
- [x] Remove file-lock scaffolding; rely on SQLite transactions for per-user concurrency.
- [x] Validate `LiveRepos` operations (mutate/append flows) against the new repositories via integration test (`src/backend/tests/liveRepos.sqlite.unit.cjs`).

## 6. Logging & Tracing Separation — Status: ✅ Completed
- [x] Keep operational logs in Pino (`logger.ts` unchanged) while persisting provider events, orchestration logs, and traces via SQLite repositories.
- [x] Implement SQL-based pruning for provider/orchestration/fetcher logs and traces during append operations.
- [x] Ensure conversation diagnostics query repositories directly for a specific conversation instead of loading entire tables.

## 7. Testing & Verification — Status: ⏳ Pending
- Add integration tests under `src/backend/tests/sqlite/*.cjs` (reuse Node test runner) covering CRUD + transactional operations for each repository.
- Provide fixture loader that spins up ephemeral DBs per test (in tmp dir) and tears them down.
- Validate schema invariants: missing required fields must reject with descriptive errors; wrong enums should throw before SQL execution.

## 8. Operational Notes — Status: ⏳ Pending
- Document bootstrap steps in `docs/DEVELOPER.md`: dependency (`better-sqlite3`), init command, backup/restore via `VACUUM INTO`.
- Provide runbook snippet for per-user DB inspection (`sqlite3 data/users/<uid>/user.sqlite3`).
- Leave encryption hooks (key fetch + `PRAGMA key`) stubbed but disabled until compliance requires activation.
