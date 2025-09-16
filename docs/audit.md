# vxMailAgent — Ongoing Audit

First opened: 2025-09-12 • Last updated: 2025-09-16

Scope: Backend (+ shared, frontend refs). Focus: orchestration contract, tools, repositories, routes, logging, and strict AGENTS.md discipline.

## Executive Summary

- Policy set: Root‑Cause‑First (RCF) and No Backend Fallbacks are explicit in AGENTS.md. Each route has a Single Source of Truth (SOT). UI may degrade; backend does not fabricate data.
- Fixed: director step timeouts; auth redirect + CORS; email ingestion persists to `emails.json` (and `/api/emails` reads SOT only); meta discovery tool handlers; workspace provenance; semantics validator normalization; unknown director tools routed through the generic handler.
- Open: none at this time (all items in the current Status Board iteration are resolved).

## Status Board

### Open Issues (RCF targets)

- None.

### Resolved Since 2025‑09‑12

- Director step timeouts enforced with Promise.race and engine timeout logging.
  - Files: `src/backend/services/conversation-orchestrator.ts`, `src/backend/services/orchestration-agent.ts`.
- Email store SOT respected; ingestion upserts to `emails.json`; `/api/emails` reads SOT only.
  - Files: `src/backend/services/email-fetcher.ts`, `src/backend/liveRepos.ts`, `src/backend/routes/emails.ts`.
- OAuth redirect + CORS fixed: safe default redirect to `/`; dev CORS credentials enabled with allowlisted origin.
  - Files: `src/backend/routes/auth-session.ts`, `src/backend/bootstrap/app.ts`.
- Meta discovery tools implemented: `list_agents`, `list_tools`, `describe_tool`, `read_api_docs` (stubbed, neutral).
  - Files: `src/backend/toolCalls.ts`, `src/shared/tools.ts`.
- Workspace provenance enforced; semantics validator normalized to base kinds (calendar/filesystem/todo/memory).
  - Files: `src/backend/toolCalls.ts`, `src/backend/services/conversation-orchestrator.ts`.
- Unknown director tools routed to generic handler; contract guard ensures every tool_call has a tool reply.
  - Files: `src/backend/services/conversation-orchestrator.ts`.

## Decisions & Policies (Authoritative)

- Root‑Cause‑First: fix producers, not consumers. No backfill/synthesis in backend routes.
- UI‑only degradation: backend returns truth (empty/error) without inventing data.
- SOT per route: `/api/emails` → `emails.json`; `/api/conversations` → `conversations.json`; orchestration → `logs/orchestration.json`; provider events → `logs/provider-events.json`; workspaces → `workspaceItems.json`.
- Defaults: allowed only for non‑invariants; must be allowlisted, documented inline, and WARN once.
- Safe semantics: use `??` only for typed optionals; no `||` defaulting on identifiers.

## Evidence & File References

- Director timeouts: `src/backend/services/conversation-orchestrator.ts`, `src/backend/services/orchestration-agent.ts`.
- Email SOT + upsert: `src/backend/services/email-fetcher.ts`, `src/backend/liveRepos.ts`, `src/backend/routes/emails.ts`.
- OAuth/CORS: `src/backend/routes/auth-session.ts`, `src/backend/bootstrap/app.ts`.
- Meta tools: `src/backend/toolCalls.ts`, `src/shared/tools.ts`.
- Workspace provenance & validator mapping: `src/backend/toolCalls.ts`, `src/backend/services/conversation-orchestrator.ts`.
- Diagnostics route risks: `src/backend/routes/conversations-enhanced.ts`.
- Workspaces association best‑effort: `src/backend/routes/workspaces.ts`.

## Next Actions (strict RCF; ordered)

- None for this iteration.

### Resolved Since 2025‑09‑16

- Ingestion invariants enforced; placeholders removed; invalid envelopes dropped with WARN logs (no synthesis).
  - Files: `src/backend/providers/mail/gmail.ts`, `src/backend/services/email-fetcher.ts`.
  - Exit criteria: Provider returns raw headers; fetcher upserts only envelopes with non‑empty `subject`/`from`/`to`/`date` and parseable `date`; invalids logged as `invalid_envelope_dropped`.
- Diagnostics route hardened: safe JSON parse for tool results; no fabricated timestamps.
  - File: `src/backend/routes/conversations-enhanced.ts`.
  - Exit criteria: Invalid JSON yields `error: 'invalid_tool_result_json'`; `timestamp` omitted when absent.
- Tool stubs fail closed: calendar/todo/filesystem return `not_implemented`.
  - File: `src/backend/toolCalls.ts`.
  - Exit criteria: Calls return `{ success: false, error: 'not_implemented' }`.
- Descriptor drift removed: `ToolFlags.defaultEnabled` dropped; gating remains `mandatory || enabledSet.has(name)`.
  - Files: `src/shared/types.ts`, `src/shared/tools.ts`, `src/backend/utils/tools.ts`.
  - Exit criteria: Types compile; only mandatory tools exposed by default.
- Workspace delete warnings: association update failures now WARN with context; deletion proceeds independently.
  - File: `src/backend/routes/workspaces.ts`.
  - Exit criteria: WARN emitted on failure; no swallowed errors; delete behavior unchanged.

Notes: Historical iterations are condensed into the Status Board to keep this audit single‑sourced and easy to scan.
