1. Audit `directors` and `agents` tables for missing/empty `enabledToolCalls`; document legacy rows requiring remediation before enforcing invariants. (Done 2025-09-23)
   - Findings: No SQLite records present; legacy JSON under `data/legacy/` and `data/legacy/users/google_115075331003198785424/` contains 1 director (`ohwl7g6g`) and 2 agents (`kd8xzbqc`, `xz3r2xkr`) with `enabledToolCalls: []`.
   - Required remediation: populate optional tool allowlists for those records before enforcing repo validation.
2. Backfill `enabledToolCalls` for legacy directors/agents based on intended tool registry per record; block entries lacking authoritative config. (Skipped 2025-09-23 – `data/legacy` is archival only; no migrations per Caesar.)
3. Enforce repo-level validation using `tool-config-service` so director/agent persistence rejects empty or invalid optional tool lists. (Done 2025-09-23)
   - Route guard: `src/backend/routes/directors.ts` and `src/backend/routes/agents.ts` now require non-empty allowlists via `validateDirectorToolConfig`/`validateAgentToolConfig`.
   - Persistence guard: `src/backend/storage/sqlite/repositories/directors.ts` and `.../agents.ts` validate before writing to SQLite.
4. Replace raw descriptor assembly in `toolCalls.ts` with `tool-config-service` APIs, removing direct repository reads of `enabledToolCalls`. (Done 2025-09-23)
   - Helpers: `src/backend/utils/tool-config-fetchers.ts` resolves director/agent descriptors via the shared service.
   - Consumers: `src/backend/toolCalls.ts` now calls the helpers and no longer inspects `enabledToolCalls` directly.
5. Audit conversation records for absent `lastActiveAt`/`startedAt` timestamps and prepare remediation script if gaps exist. (Done 2025-09-23)
   - Checked legacy archives `data/legacy/users/google_115075331003198785424/conversations.json` and `.../google_105778401035214143955/conversations.json`; no active records missing timestamps (jq filter confirmed zero offenders).
   - No SQLite conversation data present; enforcement work should target future repo writes once mutation guards are hardened.
6. Harden conversation mutation helpers and route fetch path to throw when required timestamps are missing; drop fallback ordering. (Done 2025-09-23)
   - Mutation guard: `src/backend/services/conversation-mutations.ts` and `src/backend/liveRepos.ts` now assert `startedAt`/`lastActiveAt` integrity before mutating threads.
   - Routing guard: `src/backend/routes/conversations.ts` uses strict `lastActiveAt` timestamps (no `startedAt` fallback) and fails closed when data is invalid.
7. Tighten accounts route request validation to fail closed on missing required properties instead of casting empty bodies. (Done 2025-09-23)
   - POST guard: `src/backend/routes/accounts.ts` now rejects non-object bodies and missing `id`, `provider`, `email`, `signature`, or token fields before invoking `createAccount`.
8. Update workspace tool handlers to guarantee non-null `result` payloads and remove `(result || {})` fallback in orchestrator once invariants hold. (Independent)
9. Introduce strict validation for `payload.target.role` prior to helper usage; reject requests lacking role metadata. (Done 2025-09-23)
   - Route guard: `src/backend/routes/prompts.ts` normalizes and validates `payload.target`/`payload.target.role`/`query.target` before invoking helpers.
   - Helper cleanup: `src/backend/utils/prompt-helpers.ts` no longer defaults missing roles when computing `TargetSpec`.
10. Define and enforce logger metadata/annotation schema so logging calls with incomplete data throw; update call sites accordingly. (Done 2025-09-23)
    - Schema guard: `src/backend/services/logger.ts` validates meta objects and requires `traceId` when context is supplied.
    - No call sites needed changes yet; existing usage already complies with object meta and optional context.
11. Add Gmail part ingestion validation to reject fragments missing `mimeType`; ensure workspace persistence only receives validated parts. (Done 2025-09-23)
    - Gmail provider: `src/backend/providers/mail/gmail.ts` now throws `gmail_part_missing_mime_type` when a Gmail part lacks a MIME type instead of defaulting to empty string.
