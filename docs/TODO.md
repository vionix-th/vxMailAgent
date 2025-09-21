# Backend TODO (from AUDIT) — Dependency‑Ordered

Author: The Caesar
Source: docs/AUDIT.md (2025-09-21)
Scope: Backend only; producer‑first fixes. No shims or consumer workarounds.

Note: Each task lists predecessors so work can proceed safely without breaking invariants.

1) T01 — Producer init for per‑user Settings and Templates (Critical)
- Summary: Persist defaults at bundle creation; remove need for route/service synthesis.
- Predecessors: none
- Files: `src/backend/repository/registry.ts`, `src/backend/services/settings.ts`, `src/backend/routes/templates.ts`
- Change Gate:
  - Defect Hypothesis: Missing producer initialization causes consumers to fabricate objects.
  - SOT: `userPaths(uid).settings`, `userPaths(uid).templates`.
  - Repair Location: `RepoBundleRegistry.getBundle()` — when creating a new bundle or finding empty files, write a single Settings object and seed Templates (optimizer).
  - Exit Criteria: Fresh user → `settings.json` and `templates.json` contain persisted records; first GET performs no writes.

2) T02 — Remove consumer‑side Settings synthesis (High)
- Summary: Stop constructing defaults in route/service; rely on persisted record from T01.
- Predecessors: T01
- Files: `src/backend/routes/settings.ts`, `src/backend/services/settings.ts`
- Change Gate:
  - Defect Hypothesis: Route/service invents primary data.
  - SOT: `settings.json`.
  - Repair Location: Replace local `defaultSettings()` usage with `loadSettings()`; make service error if missing (should not occur after T01).
  - Exit Criteria: No code path fabricates Settings; GET/PUT operate on persisted record only.

3) T03 — Remove GET‑time seeding in Templates route (High)
- Summary: Make GET read‑only; do not seed on read.
- Predecessors: T01
- Files: `src/backend/routes/templates.ts`
- Change Gate:
  - Defect Hypothesis: GET mutates store; masks missing producer init.
  - SOT: `templates.json`.
  - Repair Location: Delete seeding branches in loader; delegate to producer init.
  - Exit Criteria: GET never writes; seeded data exists from T01.

4) T04 — Enforce atomic conversation mutations; remove non‑atomic fallback (High)
- Summary: Require `mutate()` on conversations repo; delete read‑modify‑write fallback.
- Predecessors: none
- Files: `src/backend/liveRepos.ts`
- Change Gate:
  - Defect Hypothesis: Non‑atomic fallback can lose updates under concurrency.
  - SOT: `conversations.json` via `FileJsonRepository` (has `mutate`).
  - Repair Location: In `appendMessagesToConversation()` and `finalizeThreadStatusAtomic()` throw if `mutate` is missing instead of falling back.
  - Exit Criteria: All updates use a single `mutate()` critical section; no fallback code remains.

5) T05 — Remove `workspaceId` injection into ConversationThread (Medium)
- Summary: Stop adding ad‑hoc `workspaceId` to threads; derive association by `conversationId`.
- Predecessors: none
- Files: `src/backend/services/workspace-service.ts`, `src/backend/routes/workspaces.ts`
- Change Gate:
  - Defect Hypothesis: Domain leakage via undeclared field; violates schema.
  - SOT: `workspaceItems.json` keyed by `provenance.conversationId`.
  - Repair Location: Delete or no‑op `updateConversationWorkspaceAssociation`; remove call site in delete path.
  - Exit Criteria: No serialized thread includes `workspaceId`; behavior unchanged for listing/removal.

6) T06 — Make `/api/conversations/byDirectorEmail` pick most recent by timestamp (Medium)
- Summary: Use max by `lastActiveAt` (fallback `startedAt`) instead of array tail.
- Predecessors: none
- Files: `src/backend/routes/conversations.ts`
- Change Gate:
  - Defect Hypothesis: Insertion order ≠ recency; returns wrong thread.
  - SOT: `conversations.json` timestamps.
  - Repair Location: Compute best match with explicit comparator.
  - Exit Criteria: For multiple matches, endpoint returns the thread with latest `lastActiveAt`.

7) T07 — Consolidate logging into a single canonical module (Medium)
- Summary: Unify `services/logging.ts` and `services/logging-handlers.ts` behind one interface; update imports.
- Predecessors: none
- Files: `src/backend/services/logging.ts`, `src/backend/services/logging-handlers.ts`, call sites (`server.ts`, orchestrator, routes, fetcher manager)
- Change Gate:
  - Defect Hypothesis: Split implementations cause drift (fire‑and‑forget vs awaited).
  - SOT: per‑user `provider-events.ndjson`, `traces.json` (+ journals).
  - Repair Location: Choose one (prefer awaited), export both sync/async façades; remove duplicate.
  - Exit Criteria: Single import path used project‑wide; consistent append semantics.

8) T08 — Logging consistency and dev verbosity (Medium)
- Summary: Establish a single logging policy and consistent debug/trace coverage across modules. In development, increase actionable visibility; in production, preserve current behavior and redaction.
- Predecessors: T07
- Files: `src/backend/services/logger.ts`, canonical logging module from T07, `src/backend/repository/fileRepositories.ts`, `src/backend/services/conversation-orchestrator.ts`, `src/backend/services/email-processor.ts`, `src/backend/routes/**`, `src/backend/utils/file-lock.ts`
- Change Gate:
  - Defect Hypothesis: Inconsistent logging and sparse trace/debug output hinder developer diagnosis; ad‑hoc warnings are insufficient.
  - SOT: Provider events/traces journals; app logs via `logger.ts`.
  - Repair Location:
    - Define logging contract (levels, fields): always include `traceId|runId|conversationId|directorId|agentId` when available.
    - Honor `LOG_LEVEL` with defaults: dev=debug, prod=info; keep redaction via existing `TRACE_REDACT_FIELDS`.
    - When `TRACE_VERBOSE=true`, add redacted request/response payloads (already supported) and ensure consistent usage in engine/orchestrator.
    - NDJSON dev behavior: keep one‑time WARN summary for skipped encrypted lines and add debug‑level per‑line skip details when `LOG_LEVEL=debug`; production keeps strict throw.
    - File locks: add debug spans for acquire/release/timeout to aid contention diagnosis.
  - Exit Criteria: In development with `LOG_LEVEL=debug`, critical flows (fetcher, orchestration steps, tool calls, repo mutations, file locks) emit consistent, correlated debug lines with IDs; production behavior unchanged except for consolidation from T07.

9) T09 — Merge conversations routers into a single module (Medium)
- Summary: Fold `conversations-enhanced.ts` into `conversations.ts` or compose via a single exported router.
- Predecessors: T06 (touches conversations code paths)
- Files: `src/backend/routes/conversations.ts`, `src/backend/routes/conversations-enhanced.ts`, `src/backend/routes/index.ts`
- Change Gate:
  - Defect Hypothesis: Split ownership increases drift and discoverability issues.
  - SOT: Conversations + diagnostics stores.
  - Repair Location: Co-locate routes; ensure no path regressions.
  - Exit Criteria: One canonical conversations router mounted once; endpoints unchanged.

10) T10 — Centralize OpenAI tool spec mapping (Low)
- Summary: Keep a single `toOpenAiToolSpec` helper; use everywhere.
- Predecessors: none
- Files: `src/backend/utils/tools.ts`, `src/backend/services/engine.ts`, `src/backend/toolCalls.ts`
- Change Gate:
  - Defect Hypothesis: Duplicate registry→OpenAI mapping risks divergence.
  - SOT: `src/shared/tools.ts` registry.
  - Repair Location: Export one helper; refactor callers.
  - Exit Criteria: One source of truth for mapping; identical tool exposure behavior.

11) T11 — Hide/flag Outlook onboarding stub (Low)
- Summary: Remove or guard placeholder until implemented.
- Predecessors: none
- Files: `src/backend/routes/accounts.ts`
- Change Gate:
  - Defect Hypothesis: Dead route comments/paths create confusion.
  - SOT: N/A.
- Repair Location: Gate via feature flag or remove from surface.
- Exit Criteria: No dead feature hints visible in routes.

12) T12 — Introduce request schema validation middleware (Follow‑up)
- Summary: Add global schema validation for POST/PUT; fail closed.
- Predecessors: none
- Files: Middleware layer + route modules
- Change Gate:
  - Defect Hypothesis: Inconsistent validation across routes.
  - SOT: Route request bodies.
  - Repair Location: Add middleware, apply to mutating endpoints; reuse existing minimal validator where feasible.
  - Exit Criteria: All mutating routes reject invalid bodies with 4xx; no silent coercions.

Implementation guidance: Respect “Root‑Cause‑First; No Backend Defaults for Invariants”. Do not add shims or consumer fallbacks; repair producers and remove palliative code where noted.
