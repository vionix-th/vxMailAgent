# TODO — Replace `setAll`/`getAll`

1. ✅ Finalize per-entity repository contracts (methods + invariants) in `docs/DESIGN.md` and adjust `src/backend/repository/core.ts` to drop the bulk-write interface.
2. ✅ Update repository factory/wiring (`src/backend/repository/registry.ts`, `src/backend/utils/repo-access.ts`) to return typed repositories exposing the new methods.
3. ✅ Implement targeted persistence operations for accounts (insert/update/delete) inside `src/backend/storage/sqlite/repositories/accounts.ts` and migrate `src/backend/services/accounts.ts` to call them.
4. Repeat step 3 for prompts/templates/agents/directors/filters (shared CRUD routes) so `createCrudRoutes` delegates to repository-level operations instead of array rewrites.
5. Implement conversation/workspace/memory-specific operations (`append`, `update`, `delete`) directly in their repositories; remove list-surgery logic from `src/backend/liveRepos.ts` and related tool calls.
6. Delete remaining `setAll` usages, remove the method from repositories/tests, and backfill concurrency-kill tests to confirm no regression.
