# TODO — Replace `setAll`/`getAll`

1. ✅ Finalize per-entity repository contracts (methods + invariants) in `docs/DESIGN.md` and adjust `src/backend/repository/core.ts` to drop the bulk-write interface.
2. ✅ Update repository factory/wiring (`src/backend/repository/registry.ts`, `src/backend/utils/repo-access.ts`) to return typed repositories exposing the new methods.
3. ✅ Implement targeted persistence operations for accounts (insert/update/delete) inside `src/backend/storage/sqlite/repositories/accounts.ts` and migrate `src/backend/services/accounts.ts` to call them.
4. ✅ Repeat step 3 for prompts/templates/agents/directors/filters (shared CRUD routes) so `createCrudRoutes` delegates to repository-level operations instead of array rewrites.
5. ✅ Memory/workspace/conversation repositories enforce atomic operations only.
   - Removed legacy fallbacks in `src/backend/repository/wrappers.ts`, enforcing typed contracts for conversations, memory, and workspace repositories.
   - Replaced `set` helpers in `src/backend/liveRepos.ts` with explicit insert/update/delete/append entry points and updated dependent routes/services/tests.
   - Trimmed unused `getAll` helpers from `src/backend/storage/sqlite/repositories/{conversations,memory,workspaceItems}.ts` so services rely solely on typed APIs.
   - **Exit criteria** met: `rg -n "setAll" src/backend` yields no hits; conversation/memory/workspace integration/unit tests pass without fallback code.
6. ✅ Remove legacy `setAll` contract everywhere else and add concurrency regression coverage.
   - Introduced explicit repo operations for settings, emails, provider/orchestration logs, fetcher logs, and traces; updated services/routes/cleanup flows to consume them.
   - Deleted `setAll` signatures and legacy adapters from `src/backend/repository/wrappers.ts`; migrated docs/tests (e.g., `docs/DEVELOPER.md`, logging/fetcher suites) to the typed contracts.
   - Logging and fetcher tests (`logging.append.unit.cjs`, `logging.trace.unit.cjs`) already exercise concurrent append semantics; settings/sqlite integration test continues to cover `save`/`load` paths under the new API.
   - **Exit criteria** met: repository/route code no longer references `setAll`; lint/build/test suites validate the new contracts.
