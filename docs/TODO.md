# TODO — Replace `setAll`/`getAll`

1. ✅ Finalize per-entity repository contracts (methods + invariants) in `docs/DESIGN.md` and adjust `src/backend/repository/core.ts` to drop the bulk-write interface.
2. ✅ Update repository factory/wiring (`src/backend/repository/registry.ts`, `src/backend/utils/repo-access.ts`) to return typed repositories exposing the new methods.
3. ✅ Implement targeted persistence operations for accounts (insert/update/delete) inside `src/backend/storage/sqlite/repositories/accounts.ts` and migrate `src/backend/services/accounts.ts` to call them.
4. ✅ Repeat step 3 for prompts/templates/agents/directors/filters (shared CRUD routes) so `createCrudRoutes` delegates to repository-level operations instead of array rewrites.
5. ☐ Memory/workspace/conversation repositories enforce atomic operations only.
   - Drop legacy fallbacks in `src/backend/repository/wrappers.ts` so conversations/memory/workspace repos must implement the typed contract instead of `{ getAll, setAll }` helpers.
   - Remove `set`/list-surgery helpers from `src/backend/liveRepos.ts` and ensure all conversation/workspace entry points call repo-level `insert`/`update`/`delete`/`append` APIs directly.
   - Migrate memory + workspace services/routes/tests to rely on repo methods (`insert`, `update`, `deleteMany`, etc.) and delete unused `getAll` aliases from `src/backend/storage/sqlite/repositories/{conversations,memory,workspaceItems}.ts`.
   - **Exit criteria**: `rg -n "setAll" src/backend` yields no hits that touch conversations, memory, or workspace flows; existing integration tests for conversation append/memory delete/workspace revisions pass without fallback code.
6. ☐ Remove legacy `setAll` contract everywhere else and add concurrency regression coverage.
   - Inventory remaining usages (logging/services cleanup, settings/emails/provider events/traces repositories, docs/tests) and introduce explicit repo methods (`append`, `truncate`, `replaceDefaults`, etc.) per entity.
   - Extend SQLite repositories and wrappers to expose the new operations; update services/routes/cleanup flows to consume them; delete the `setAll` signature from `src/backend/repository/wrappers.ts` and any legacy adapters.
   - Update `docs/DEVELOPER.md` (remove `repoFns` `{ getAll, setAll }` guidance) and ensure onboarding docs point to the typed contracts.
   - Backfill concurrency kill-tests simulating interleaved read/write on logs/settings (e.g., `src/backend/tests/logging.*`, `src/backend/tests/sqlite/settings.integration.cjs`).
   - **Exit criteria**: repository/route code no longer references `setAll`; concurrency-focused tests demonstrate atomic append/truncate behavior with the new contracts.
