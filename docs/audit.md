# Backend Code Quality Audit — vxMailAgent

Date: 2025-09-17

Scope: Backend only (`src/backend`, `src/shared`). Producer‑first, no code changes performed.

## Executive Summary

- Critical: Diagnostics data leaks into domain objects. `traceId` is embedded in persisted `ConversationThread` records, violating diagnostics/data separation and enabling cross‑concern coupling. Risk: integrity drift, schema ambiguity, accidental exposure. Files: `src/backend/services/email-processor.ts`, `src/backend/services/orchestration-agent.ts`.
- High: Append‑only logs implemented via read‑modify‑set. Repos read entire arrays, push, then rewrite under a lock. Violates atomic append rule and scales poorly with TTL pruning. Risk: contention, partial writes on large files. Files: `src/backend/repository/fileRepositories.ts` (append methods).
- High: Persistence encryption defaults to plaintext when `VX_MAILAGENT_KEY` is unset/invalid. Only a WARN is emitted; server still starts. In production this is an explicit fail‑closed requirement. Files: `src/backend/persistence.ts`, `src/backend/config.ts`, `src/backend/index.ts`.
- High: Producer routes allow invalid Director/Agent records. `promptId` may be defaulted to empty and not validated; consumer code later compensates during orchestration. Risk: latent runtime failures and hidden misconfig. Files: `src/backend/routes/directors.ts`, `src/backend/routes/agents.ts`, consumer compensation in `src/backend/services/email-processor.ts`.
- Medium: Duplicated tool handlers. `src/backend/toolCalls.ts` contains multiple repeated switch cases for `list_tools`, `describe_tool`, `read_api_docs`, creating drift risk and inconsistent behavior. Production stability breach.
- Medium: Settings loader masks repository/JSON errors by returning defaults on error. Violates fail‑closed; can hide corruption/permission problems. File: `src/backend/services/settings.ts`.
- Medium: Secrets modeled in shared types. `ApiConfig.apiKey` is exported to frontend via `src/frontend/src/types/shared.ts` (type surface), even though GET /settings redacts values. Risk: accidental leakage via typing or dev logging. Files: `src/shared/types.ts`, `src/frontend/src/types/shared.ts`, `src/backend/routes/settings.ts`.
- Low: Overuse of `||` defaulting on required identifiers/dates in sensitive paths (OIDC/email headers/workspace). Most are later validated, but patterns violate the defaulting rule and risk subtle gaps. Files include `src/backend/auth/oidc/flows.ts`, `src/backend/routes/memory.ts`, `src/backend/services/orchestration-director.ts`, `src/backend/toolCalls.ts`.

## Findings

### Architecture / Design

- Diagnostics embedded in domain model (Critical)
  - Evidence: `src/backend/services/email-processor.ts:235` creates a `ConversationThread` with `traceId` field; `src/backend/services/orchestration-agent.ts:46,66` sets `traceId` on agent threads.
    - Excerpt: `... agentThread = { id: ..., kind: 'agent', ..., traceId, ... } as ConversationThread;`
  - Defect Hypothesis: The producer that constructs conversation threads is polluting the domain object with diagnostics metadata. Broken invariant: “Domain models must not embed tracing/diagnostic fields.”
  - SOT Declaration: Conversations are persisted in per‑user `conversations.json` via repo bundle (`src/backend/repository/registry.ts`, `LiveRepos.setConversations`).
  - Recommended Repair (producer‑only): Remove `traceId` from thread objects at creation/update time. Pass trace context strictly through orchestration method parameters and the tracing repositories (`TracesRepository`, `OrchestrationLogRepository`). If trace linkage is needed, store the mapping in diagnostics logs (by `conversationId`) rather than in the conversation record.
  - Exit Criteria: No persisted conversation contains a `traceId` key; orchestration and routes operate using `conversationId` + tracing repos only; UI and APIs never read `traceId` from conversations.
  - Side effects/Risks: Any code reading `thread.traceId` must be updated to read from context; search indicates reads are minimal (context‑based already). Validate no frontend relies on it.

- Append‑only logs via read‑modify‑set (High)
  - Evidence: `FileFetcherLogRepository.append`, `FileProviderEventsRepository.append`, `FileOrchestrationLogRepository.append`, `FileTracesRepository.append` all do: `getAll(); list.push(e); writeAllUnlocked(list)` under `withFileLock` (e.g., `src/backend/repository/fileRepositories.ts:268-285, 303-317, 341-357, 675-709`).
  - Defect Hypothesis: Broken invariant: “Append‑only logs use atomic append (no read‑modify‑set).” Current approach scales poorly and increases contention; TTL pruning is entangled with append logic.
  - SOT Declaration: Per‑user logs under `users/<uid>/logs/*.json` (providerEvents, fetcher, orchestration, traces).
  - Recommended Repair (producer‑only): Redesign log repos to append records atomically without reading full arrays. Options:
    - Switch to newline‑delimited JSON (NDJSON) per record with fs `appendFile` + periodic compaction for TTL/max‑items.
    - Or maintain a write‑ahead journal file and a compacted snapshot file; readers merge on load. Keep encryption at record level if required.
  - Exit Criteria: Append path does not load existing content; writes are atomic appends; TTL/max‑items pruning occurs in a separate compaction path that never synthesizes entries.
  - Side effects/Risks: Format change requires one‑time compaction/upgrade. Keep reader tolerant during rollout.

- Insecure plaintext persistence by default (High)
  - Evidence: `src/backend/persistence.ts:19-28` returns `undefined` key → plaintext mode with WARN; `src/backend/index.ts:7` calls `warnIfInsecure()`; `src/backend/config.ts` doesn’t fail closed for missing `VX_MAILAGENT_KEY`/`JWT_SECRET` in prod.
  - Defect Hypothesis: Broken invariants: “Fail Closed” and “Security defaults”. Without a valid key, primary data are stored unencrypted.
  - SOT Declaration: Encryption key via `VX_MAILAGENT_KEY`; persistence is the authoritative store for all per‑user data.
  - Recommended Repair (producer‑only): In production, throw on missing/invalid `VX_MAILAGENT_KEY` and on `JWT_SECRET` equal to defaults. Allow a dev/test allowlist default with single WARN. Keep current redaction for tracing payloads.
  - Exit Criteria: Server startup in production fails fast if `VX_MAILAGENT_KEY` is not a 64‑hex string or if `JWT_SECRET` equals the known dev default.
  - Side effects/Risks: Requires ops to set keys; document dev vs prod behavior clearly.

- Secrets appear in shared/public types (Medium)
  - Evidence: `src/shared/types.ts:398` includes `ApiConfig { apiKey: string }`; re‑exported by `src/frontend/src/types/shared.ts`. GET `/api/settings` redacts but type surface still models secrets client‑side.
  - Defect Hypothesis: Policy breach “keep secrets out of shared/public types.” Increases risk of accidental exposure via typing or logs.
  - SOT Declaration: API configs are persisted under per‑user `settings.json` (backend SOT); frontend should only see non‑secret projection.
  - Recommended Repair (producer‑only): Split types: Backend‑only `ApiConfigSecret` (with `apiKey`) and shared `ApiConfigPublic` (no `apiKey`). Do not export secret types to frontend barrel. Ensure routes only use/return public shape.
  - Exit Criteria: Frontend cannot import a type that contains `apiKey`. Backend routes continue to redact.
  - Side effects/Risks: Minor type churn across backend modules; no runtime impact.

### Business Logic

- Producer accepts invalid Director/Agent configs (High)
  - Evidence: `src/backend/routes/directors.ts:23-33` sets `promptId: (director as any).promptId ?? ''`; validation enforces only `apiConfigId`. `src/backend/routes/agents.ts` enforces `apiConfigId` only. Consumer then compensates: `email-processor.validateDirectorConfig` rejects missing prompt/api.
  - Defect Hypothesis: Broken invariant at the producer boundary: required identifiers must be present. Compensation at consumer violates Root‑Cause‑First.
  - SOT Declaration: Per‑user `directors.json` / `agents.json` via `LiveRepos`.
  - Recommended Repair (producer‑only): In routes, validate `promptId` and `apiConfigId` are non‑empty strings; remove defaulting `promptId` to `''`. Reject on failure. Keep `enabledToolCalls` sanitized only.
  - Exit Criteria: POST/PUT for Directors/Agents fail when `promptId` or `apiConfigId` missing/empty; orchestrator no longer needs to guard for empty configs beyond existence checks.
  - Side effects/Risks: Existing invalid records will be rejected on update; consider a one‑time cleanup endpoint to surface/fix them.

- Over‑defaulting of identifiers/dates (Medium)
  - Evidence: OIDC flow: `src/backend/auth/oidc/flows.ts:40-47` uses `info?.sub || info?.id || ''` and `info?.email || ''` before validating. Memory route: `src/backend/routes/memory.ts:26-33` uses `entry.id = entry.id || newId(); entry.created = entry.created || new Date().toISOString();`. Workspace tool call: defaults for `mimeType`, `encoding`, and empty `data` (`src/backend/toolCalls.ts:497-514`).
  - Defect Hypothesis: While many paths re‑validate, the pattern violates “never use `||` to default identifiers/dates”. Risks introducing silent empties into persisted records.
  - SOT Declaration: User records (`users.json`), memory store, workspace items.
  - Recommended Repair (producer‑only): Replace `||` defaults with explicit validation + construction. For create flows, generate server‑side ids/dates explicitly (not as `||` fallbacks). For OIDC, read fields and throw if absent without ever assigning empty defaults.
  - Exit Criteria: No `|| ''` for required fields; creates set ids/dates explicitly; updates validate provided fields.
  - Side effects/Risks: Minimal; improves clarity and conformance.

- Settings loader masks corruption (Medium)
  - Evidence: `src/backend/services/settings.ts:25-43` catches and returns `defaultSettings()` on any error.
  - Defect Hypothesis: Violates fail‑closed; consumers proceed with defaults on unreadable/corrupt files.
  - SOT Declaration: Per‑user `settings.json` via `LiveRepos`.
  - Recommended Repair (producer‑only): Only return defaults when repository returns empty array (no file). On read/parse errors from repo, propagate a 500 to surface the fault. Optionally annotate with a user‑action hint.
  - Exit Criteria: Corrupted settings trigger 500; missing settings still return defaults.
  - Side effects/Risks: Surfacing errors may require UI messaging for recovery.

### Best Practices & SOLID

- Duplicated tool handlers (Medium)
  - Evidence: `src/backend/toolCalls.ts` has repeated cases for `list_tools`, `describe_tool`, `read_api_docs` (e.g., lines ~60–95 and ~166–205 and ~214–241). Behavior differs slightly.
  - Defect Hypothesis: Violates SRP/production stability; likely copy‑paste residue.
  - SOT Declaration: Tool registry (`src/shared/tools.ts`) is the SOT for tool descriptors.
  - Recommended Repair (producer‑only): Consolidate to single cases; derive behavior from SOT (`TOOL_REGISTRY`, `TOOL_DESCRIPTORS`) consistently. Add a small helper to DRY list/describe logic.
  - Exit Criteria: Exactly one switch case per tool; tests that assert tool visibility still pass.
  - Side effects/Risks: None beyond reduced drift risk.

- Type exposure of secrets (Medium)
  - Evidence: As above under Architecture.
  - Recommended Repair: Create backend‑only types module for secrets; expose public projection in shared types.

### Deprecated / Unused

- Legacy placeholders and comments (Low)
  - Evidence: `src/backend/routes/accounts.ts:68` TODO about Outlook onboarding; no runtime impact. No other `TODO/FIXME/@deprecated/legacy/XXX` patterns in backend codebase.
  - Recommended Repair: Track via issue; no code change required for this audit.

### Consolidation

- Consolidate tool list/describe logic (Medium)
  - Evidence: Duplicated switch cases in `toolCalls.ts` cause drift.
  - Recommended Repair: Single implementation + small helpers. See “Best Practices & SOLID”.
  - Exit Criteria: One code path for each tool; consistent gating via `TOOL_DESCRIPTORS`.

- Centralize provenance validation for workspace tools (Low)
  - Evidence: `workspace_add_item` validates provenance locally; similar checks recur in orchestrator agent path.
  - Recommended Repair: A shared validator util for workspace provenance so routes and tool handler don’t diverge.

## Single Source of Truth (SOT) Map

- Users (system): `createSystemJsonRepository` at `src/backend/initRepos.ts`; file: `data/users.json` (via `utils/paths.ts`).
- Per‑user bundles (authoritative stores): `src/backend/repository/registry.ts` → `userPaths(uid)` under `data/users/<uid>/...`.
  - Conversations: `conversations.json` (never synthesize; only mutate via `setConversations`).
  - Emails: `emails.json` (upsert by id in fetcher; no synthesis).
  - Settings: `settings.json` (GET returns sanitized projection).
  - Accounts: `accounts.json`.
  - Inventory: `prompts.json`, `agents.json`, `directors.json`, `filters.json`, `templates.json`, `imprints.json`, `workspaceItems.json`.
  - Logs (append‑only intent): `logs/fetcher.json`, `logs/orchestration.json`, `logs/provider-events.json`, `logs/traces.json`.

## Consolidation Proposals

1) Unify tool handler cases (rank: 1)
   - Trade‑offs: Minimal refactor; reduces drift and simplifies testing. No API change.
   - Migration impact: None.

2) Introduce NDJSON append format for logs (rank: 2)
   - Trade‑offs: Larger change; enables true atomic append and scalable TTL compaction. Requires readers to handle streaming or batch parse.
   - Migration impact: One‑time conversion utility; readers tolerant during rollout.

3) Split secret vs public API config types (rank: 3)
   - Trade‑offs: Type churn; improves security posture and clarity across layers.
   - Migration impact: Update imports; no runtime change.

## Follow‑ups

1) Tighten OIDC flow parsing: remove `|| ''` defaults; throw early; keep explicit field presence checks.
2) Memory routes: construct server‑side `id/created` explicitly; validate client‑supplied timestamps if allowed; remove `||` patterns.
3) Enforce production CORS origin hard requirement: already warns; consider fail‑closed if `CORS_ORIGIN='*'` in prod.
4) Add explicit “max payload” guards where `JSON.parse` is applied to network responses (Graph/OpenAI) to avoid parsing giant bodies.
5) Consider moving per‑request logging of HTTP method/url behind a leveled filter to reduce noise in prod.

