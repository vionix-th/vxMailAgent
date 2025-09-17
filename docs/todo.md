# Backend Remediation TODO (Prioritized)

Date: 2025-09-17
Scope: Backend only. Producer-first fixes; no shims or compensating layers.

## Priorities At A Glance
- P0 (Critical): must fix before next release.
- P1 (High): next sprint after P0 or parallel with clear owners.
- P2 (Medium): scheduled backlog with clear acceptance.
- P3 (Low): opportunistic cleanup.

## P0 — Critical

- [x] Diagnostics separation: remove `traceId` from persisted conversations
  - SOT: `conversations.json` (via `LiveRepos.setConversations`)
  - Repair Location: conversation producers
    - `src/backend/services/email-processor.ts` (thread construction)
    - `src/backend/services/orchestration-agent.ts` (agent thread ensure/create)
    - `src/backend/services/conversation-mutations.ts` (ensure no re-introduction)
  - Exit Criteria: No conversation record contains `traceId`; correlation uses diagnostics repos keyed by `conversationId`.
  - Notes/Risks: Audit all reads of `thread.traceId` and replace with context wiring.

- [x] Fail-closed encryption + JWT in production
  - SOT: `src/backend/config.ts`, `src/backend/persistence.ts`
  - Repair Location: config bootstrap and persistence key resolution
    - Enforce: if `NODE_ENV=production` and `VX_MAILAGENT_KEY` is not 64-hex → throw at startup.
    - Enforce: if `NODE_ENV=production` and `JWT_SECRET` equals default/dev value → throw at startup.
  - Exit Criteria: Server refuses to start in prod without strong keys; plaintext persistence never used in prod.
  - Notes/Risks: Document dev/test behavior; verify logs do not leak secret values.

- [x] Atomic append for logs (no read-modify-set)
  - SOT: per-user logs under `users/<uid>/logs/*.json`
  - Repair Location: repositories
    - `src/backend/repository/fileRepositories.ts` (append methods for fetcher, providerEvents, orchestration, traces)
  - Approach: switch to NDJSON append (fs appendFile) with periodic compaction for TTL/max-items; readers merge snapshot+journal.
  - Exit Criteria: Append path never loads full array; append is atomic; compaction is isolated and idempotent.
  - Notes/Risks: One-time migration; ensure encryption semantics are preserved per-record or per-file as decided.

- [x] Validate Director/Agent required fields at producer routes
  - SOT: `directors.json`, `agents.json`
  - Repair Location: routes
    - `src/backend/routes/directors.ts` (reject empty/missing `promptId` and `apiConfigId`; remove `promptId ?? ''` default)
    - `src/backend/routes/agents.ts` (reject empty/missing `promptId` and `apiConfigId`)
  - Exit Criteria: POST/PUT reject invalid records; orchestrator contains only sanity checks, no compensation.
  - Notes/Risks: Existing invalid records require remediation UI or a one-off script.

## P1 — High

- [x] Consolidate duplicated tool handlers
  - SOT: `src/shared/tools.ts` (`TOOL_REGISTRY`, `TOOL_DESCRIPTORS`)
  - Repair Location: `src/backend/toolCalls.ts` (single implementation for `list_tools`, `describe_tool`, `read_api_docs`)
  - Exit Criteria: One code path per tool; behavior consistent across director/agent contexts.

- [x] Settings loader fail-closed on corruption
  - SOT: `settings.json`
  - Repair Location: `src/backend/services/settings.ts`
  - Exit Criteria: Corrupt/unreadable settings propagate a 500; only absent settings return defaults.

## P2 — Medium

- [ ] Split secret vs public API config types
  - SOT: `src/shared/types.ts`
  - Repair Location: types + routes
    - Introduce backend-only `ApiConfigSecret` (with `apiKey`)
    - Keep shared `ApiConfigPublic` (no `apiKey`); ensure `/api/settings` returns public projection only
  - Exit Criteria: Frontend cannot import a type containing `apiKey`.

- [ ] Remove `||` defaulting for required identifiers/dates
  - Affected: `src/backend/auth/oidc/flows.ts`, `src/backend/routes/memory.ts`, `src/backend/services/orchestration-director.ts`, `src/backend/toolCalls.ts` (workspace add defaults)
  - Exit Criteria: Required ids/dates are validated and set explicitly; no `|| ''` on invariants.

- [ ] Centralize workspace provenance validation
  - SOT: workspace items in `workspaceItems.json`
  - Repair Location: shared validator used by tool handler and any routes
  - Exit Criteria: Single validator ensures `emailId`, `conversationId`, `createdBy`, `creatorId` present and typed.

- [ ] Add size guard before JSON.parse of external responses
  - Affected: `src/backend/utils/graph.ts`, OpenAI provider handling in `src/backend/providers/openai.ts`
  - Exit Criteria: Large bodies are bounded and rejected with descriptive errors; no unbounded parse attempts.

## P3 — Low / Backlog

- [ ] Enforce stricter CORS in production
  - Repair Location: `src/backend/bootstrap/app.ts`
  - Exit Criteria: In prod, wildcard origin cannot allow credentials; require explicit origin or refuse credentials.

- [ ] Reduce noisy request logging in prod
  - Repair Location: `src/backend/bootstrap/app.ts`
  - Exit Criteria: Log level gating or sampling applied to request logs.

## Sequencing & Dependencies
- Start with P0 in this order: diagnostics separation → encryption/JWT fail-closed → atomic append logs → route validation for Director/Agent.
- P1 can run in parallel with P0 #2 or #3 by separate owners.
- P2 tasks can be batched; type split touches more files → time-box and land early to reduce churn.

## PR Boundaries (per task)
- Include: focused producer changes, minimal deltas, updated docs where needed.
- Exclude: UI shims/adapters, consumer-side compensation, unrelated refactors.
- Each PR includes: SOT touched, repair location rationale, exit criteria, and risk notes.
