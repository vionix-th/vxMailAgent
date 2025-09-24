# Storage Audit — Repository Bulk Operations

## Scope
- Analyze SQLite-backed repositories that expose only `getAll`+`setAll` (e.g., `accounts`, `templates`, `memory`).
- Confirm race conditions and data loss risks when services perform in-memory list surgery before calling `setAll`.
- Evaluate Option 2: replace the bulk-write contract with explicit persistence operations per repository.

## Findings
- **Legacy contract enforced bulk rewrites**: The former `Repository<T>` interface exposed only `getAll()` and `setAll(next: T[])`, preventing producers from expressing targeted mutations. (Removed in favor of typed contracts during Task 1.)
- **Services operate outside storage transactions**: Example `upsertAccount` loads the full list, mutates it in memory, then writes everything back, with no transactional guard bridging `getAll`+`setAll`. (`src/backend/services/accounts.ts:25`)
- **`setAll` truncates tables**: SQLite repositories clear tables (`DELETE FROM ...`) before reinserting rows, so transient bugs or partial arrays wipe the source of truth. (`src/backend/storage/sqlite/repositories/accounts.ts:27`, `.../memory.ts:16`)
- **Queue does not serialize composite operations**: `SqliteHandle` enqueues each call separately; the read (`getAll`) and write (`setAll`) happen in two different tasks, allowing interleaving and last-writer-wins loss. (`src/backend/storage/sqlite/factory.ts:24`)
- **Mutation gaps proliferate**: Only the memory repository implements `mutate`; other tables (e.g., `templates`, `agents`, `directors`) lack atomic helpers, so all API routes share the same race-prone pattern. (`src/backend/storage/sqlite/repositories/templates.ts:24`)

## Recommendation (Option 2)
- Define per-entity repository contracts with explicit methods (`list`, `insert`, `update`, `delete`, domain-specific helpers) instead of generic list replacement. Producers become responsible for enforcing invariants close to storage.
- Update service and route layers to delegate mutations to these repository methods, eliminating ad-hoc array surgery and ensuring every write occurs inside a single transaction.
- Remove `setAll`/`getAll` from the shared interface once all repositories expose targeted operations, preventing regressions back to bulk rewrites.

## Open Decisions
- Confirm canonical shapes for each repository (which fields may mutate) so we can spec precise methods.
- Decide whether to retain a read-only `list()` helper or expose streaming/pagination if datasets grow.
- Determine concurrency requirements per table (e.g., optimistic locking vs. hard constraints) when designing new method signatures.
