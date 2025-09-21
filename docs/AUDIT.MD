# Backend Code Quality Audit — vxMailAgent (Producer‑First)

Date: 2025-09-21

Scope: Backend (src/backend/**, src/shared/**). No code changes were made; this is an actionable audit report only, per Caesar’s request.

## Findings — Architecture/Design

- Title: Route-level synthesis of Settings (High)
  - Evidence: `src/backend/routes/settings.ts:35` — `const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();`
  - Defect Hypothesis: Backend route fabricates a primary record when the authoritative store is empty, violating “Backend routes never invent data”. Origin: settings consumer (route/service) compensates for missing producer initialization.
  - SOT Declaration: Per-user `settings.json` at `userPaths(uid).settings` (created via `RepoBundleRegistry`).
  - Recommended Repair (producer‑only): Initialize a persisted default Settings object at user-bundle creation (producer: `src/backend/repository/registry.ts`) instead of returning ephemeral defaults from the route/service. Then have `GET /api/settings` read the persisted object (or 404 if initialization failed).
  - Exit Criteria: For a fresh user, `settings.json` contains a single valid Settings object; `GET /api/settings` returns that object without calling any default generator; removing the route-level default does not break clients.
  - Side effects/Risks: One-time initialization write on first access; ensure idempotency and upgrade path for existing users with `[]`.

- Title: Service-level synthesis of Settings (High)
  - Evidence: `src/backend/services/settings.ts:21` — `const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();`
  - Defect Hypothesis: Same compensating default in the service perpetuates consumer-side invention. Producer (registry) must own initialization.
  - SOT Declaration: Same as above.
  - Recommended Repair (producer‑only): Move default creation into `RepoBundleRegistry` and persist; make `loadSettings()` fail on absence or simply read persisted record.
  - Exit Criteria: `loadSettings()` never fabricates an object; it either returns persisted settings or throws.
  - Side effects/Risks: None beyond first-run write.

- Title: Non‑atomic fallback for conversation mutations (High)
  - Evidence: `src/backend/liveRepos.ts:61-72,88-98` — comment “Fallback (non-atomic)” and manual `getAll → setAll` path.
  - Defect Hypothesis: Broken atomicity invariant for conversation updates under concurrency; consumer compensates for missing `mutate()` producer capability.
  - SOT Declaration: Per-user `conversations.json` (append/update via repository with file lock).
  - Recommended Repair (producer‑only): Guarantee `mutate()` exists on the conversations repository for all code paths; delete fallback. If a repo ever lacks `mutate`, treat as programmer error and fail closed.
  - Exit Criteria: All conversation appends/finalizations execute via a single locked `mutate()`; no code paths write with non-atomic read‑modify‑write.
  - Side effects/Risks: Removes a palliative path; concurrent behavior becomes strictly serialized (intended).

- Title: Workspace association embedded into ConversationThread (Medium)
  - Evidence: `src/backend/services/workspace-service.ts:143` — `(updated as any).workspaceId = workspaceId;`
  - Defect Hypothesis: Cross‑cutting concern leaks into the domain object; ConversationThread type does not define `workspaceId`. Violates diagnostics/association separation and type contract.
  - SOT Declaration: Conversations in `conversations.json`; Workspace items in `workspaceItems.json` keyed by `conversationId` (per DESIGN.md).
  - Recommended Repair (producer‑only): Remove the mutation. If an association is needed, keep it derivable from `conversationId` or store in a separate mapping/repo. Do not add ad‑hoc fields to threads.
  - Exit Criteria: No serialized ConversationThread carries `workspaceId`; code that needs the association derives it from persisted items or a dedicated mapping.
  - Side effects/Risks: Minor refactor at call sites that read `workspaceId` (none observed on backend; frontend lists items via `/api/workspaces/:id/items`).

- Title: Divergent logging implementations (Medium)
  - Evidence: Two overlapping modules: `src/backend/services/logging.ts` (void/queued) and `src/backend/services/logging-handlers.ts` (awaited). Same conceptual feature with split APIs.
  - Defect Hypothesis: Dual implementations risk drift and inconsistent persistence semantics (fire‑and‑forget vs awaited).
  - SOT Declaration: User `provider-events.ndjson` / `traces.json(.ndjson)` via file repos.
  - Recommended Repair (producer‑only): Consolidate into a single logging service exposing both fire‑and‑forget and awaited variants behind one interface; remove the duplicate.
  - Exit Criteria: All imports reference one module; consistent append semantics; tests unaffected.
  - Side effects/Risks: Low; mechanical import updates.

## Findings — Business Logic

- Title: byDirectorEmail selects last by insertion order, not recency (Medium)
  - Evidence: `src/backend/routes/conversations.ts:83-96` — filters then picks “last matching thread in canonical insertion order”.
  - Defect Hypothesis: “Last in array” may diverge from actual most‑recent by `lastActiveAt`. Producer (selection logic) should implement explicit recency semantics.
  - SOT Declaration: `conversations.json` threads with `startedAt/lastActiveAt`.
  - Recommended Repair (producer‑only): Select max by `lastActiveAt` (fallback to `startedAt`) among matches; keep explicit comparator instead of array position.
  - Exit Criteria: For multiple matches, endpoint returns the thread with the latest `lastActiveAt`.
  - Side effects/Risks: None; behavior becomes deterministic across compactions/reorders.

- Title: GET /api/prompt-templates performs write/seed (Low)
  - Evidence: `src/backend/routes/templates.ts:31-42,54-61` — seeds defaults on read; writes through repo.
  - Defect Hypothesis: Side effects on GET break REST expectations and mask producer responsibility for initialization.
  - SOT Declaration: Per-user `templates.json`.
  - Recommended Repair (producer‑only): Seed defaults at bundle creation time or via a one‑time bootstrap task; make GET strictly read‑only.
  - Exit Criteria: First GET does not write; templates are present due to producer initialization.
  - Side effects/Risks: None.

## Findings — Best Practices & SOLID

- Title: Settings route bypasses service contract (Low)
  - Evidence: `src/backend/routes/settings.ts:34-46` uses raw `repoGetAll`/shape munging rather than `loadSettings()`.
  - Defect Hypothesis: Violates DIP; duplicates normalization logic and increases drift risk.
  - SOT Declaration: Same as Settings.
  - Recommended Repair: Route should depend on the settings service only; service owns normalization/validation.
  - Exit Criteria: GET path calls `loadSettings()`; no direct repo access from route.
  - Side effects/Risks: None.

- Title: Lax dev behavior for encrypted journals may hide issues (Low)
  - Evidence: `src/backend/repository/fileRepositories.ts:81-86` — in dev, encrypted NDJSON lines are skipped when key is invalid.
  - Defect Hypothesis: Can mask configuration errors during development; not a production risk (prod throws).
  - SOT Declaration: *.ndjson journals for traces/provider events.
  - Recommended Repair: Emit explicit WARN count for skipped lines and expose a diagnostics endpoint to surface the condition; keep prod behavior unchanged.
  - Exit Criteria: Dev logs include a one‑time WARN with skip counts; optional health signal.
  - Side effects/Risks: None.

## Findings — Deprecated/Unused

- Title: Outlook onboarding placeholder (Low)
  - Evidence: `src/backend/routes/accounts.ts:72` — “TODO: Implement Outlook account onboarding using OIDC+PKCE pattern”.
  - Defect Hypothesis: Feature gap tracked inline; not used at runtime. Documented, but should be either implemented or removed from surface to avoid dead paths.
  - SOT Declaration: N/A.
  - Recommended Repair: Hide/guard endpoint stubs behind explicit feature flags or remove until implemented; keep tests in sync.
  - Exit Criteria: No dead stubs in route surface.
  - Side effects/Risks: None.

## Findings — Consolidation

- Title: Two conversation route modules (Medium)
  - Evidence: `src/backend/routes/index.ts` mounts both `conversations.ts` and `conversations-enhanced.ts` at `/api/conversations`.
  - Defect Hypothesis: Split ownership (list/get vs details/metrics) increases navigation and drift risk.
  - SOT Declaration: Conversations, provider events, orchestration events.
  - Recommended Repair: Co-locate enhanced endpoints under the conversations module (e.g., `routes/conversations.ts`), or compose one router from sub‑routers in a single file.
  - Exit Criteria: Single canonical conversations router; no path conflicts.
  - Side effects/Risks: Pure organization; no behavior change.

- Title: Tool gating helpers spread across utils and toolCalls (Low)
  - Evidence: `src/backend/utils/tools.ts` and `src/backend/toolCalls.ts` both transform registry entries.
  - Defect Hypothesis: Minor duplication; centralizing avoids inconsistent OpenAI spec mapping.
  - SOT Declaration: `src/shared/tools.ts` registry is authoritative.
  - Recommended Repair: Keep a single transformer (`toOpenAiToolSpec`) and import where needed.
  - Exit Criteria: One canonical helper.
  - Side effects/Risks: None.

## Consolidation Proposals (Ranked)

1) Producer initialization for user data (Settings, Templates) — High
   - Trade‑offs: One‑time write at bundle creation; eliminates route‑time synthesis. Migration: write defaults where file is `[]`.
2) Unify logging service — Medium
   - Trade‑offs: Less drift; consistent append semantics. Small refactor of imports.
3) Merge conversation routers — Medium
   - Trade‑offs: Clearer ownership; fewer cross‑module dependencies. No behavioral changes.
4) Centralize tool spec mapping — Low
   - Trade‑offs: Minor cleanup; reduce duplication.

## Follow‑ups

- Add request schema validation middleware (planned in DESIGN.md) for all POST/PUT routes; fail closed on invalid bodies.
- Make `byDirectorEmail` deterministic by `lastActiveAt` as noted; add explicit comparator.
- Surface dev‑only WARN when encrypted NDJSON entries are skipped; include counts.
- Audit for any remaining ad‑hoc fields added to domain types; enforce via ESLint rule or runtime checks.

## Change Gate (for each recommended repair)

- Defect Hypothesis: Missing producer‑side initialization (Settings/Templates) causes consumer synthesis; conversation updates must be atomic; domain leakage via `workspaceId`.
- SOT Declaration: Per‑user JSON files under `userPaths(uid)`; conversations and workspace items are the authoritative stores; logs are in NDJSON journals.
- Repair Location: 
  - Initialize defaults in `src/backend/repository/registry.ts` (producer). 
  - Enforce `mutate()` in repos; delete non‑atomic fallbacks in `src/backend/liveRepos.ts` (producer). 
  - Remove `workspaceId` writes in `src/backend/services/workspace-service.ts` (producer) and rely on existing provenance.
- Exit Criteria: No route/service synthesizes primaries; conversation mutations are atomic; ConversationThread schema is respected with no extra fields.

