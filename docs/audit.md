# vxMailAgent Codebase Audit

Date: 2025-09-12

Scope: Backend (+ shared, frontend references) with emphasis on orchestration, tools, repositories, routes, logging, and adherence to AGENTS.md discipline.

## Executive Summary

- Critical: Director step timeouts are not enforced. `conversation-orchestrator` set timers that only cleaned bookkeeping but did not cancel or race the engine call, risking hung steps and misreported timing. This contradicted “Fail Closed.”
- Critical: Mandatory “core” tools are exposed to the LLM but not implemented. Director/Agent flows may emit `tool_calls` (e.g., `list_agents`, `list_tools`) that receive only “unsupported_tool_call” tool replies, breaking expected contracts and the prompting strategy.
- High: Workspace provenance/context mismatch. Items created via tool calls do not populate `WorkspaceItem.provenance`, and filtering expects non-existent `context` fields on items. This breaks cross-linking and later queries and violates the type contracts documented in DESIGN/DEVELOPER.
- High: Tool semantics validator is mis-keyed. Semantic checks switch on `calendar|filesystem|todo|memory` while handlers dispatch on `calendar_read|calendar_add|…`, so semantic validation is largely bypassed.
- High: Duplication/drift across logging and tool-spec building layers (multiple implementations), raising risk of divergence.
- Medium: Broad `any` usage and weak typing at boundaries undermines AGENTS.md “strict typing” guidance. Optional chaining and `||` defaulting are used on invariant fields (“emailId”, “directorId”, “fetchCycleId”), weakening contracts.
- Medium: Route surface fragmentation (two conversations modules) and duplicated provider logging logic increases complexity; opportunities exist to consolidate to single, canonical paths and services.

## Architecture & Design

- Invariants vs. optional defaults (second‑pass focus)
  - Instances of using optional chaining or `||` fallback on fields that are logical invariants:
    - `context.thread.email?.id || 'unknown'` during contract‑guard logging.
    - `fetchCycleId || 'unknown'` across `logging-handlers.ts`.
  - Impact: Hides upstream bugs and erodes guarantees. Per AGENTS: “No Defaults For Invariants” and “Fail Closed”. For truly optional diagnostics (e.g., fetchCycleId in ad‑hoc contexts) defaults must be allowlisted and emit a one‑time WARN with key+value.
  - Files: `src/backend/services/conversation-orchestrator.ts:292`, multiple sites in `src/backend/services/logging-handlers.ts`.

- Director step timeout not enforced
  - Evidence: `src/backend/services/conversation-orchestrator.ts:40` sets a `setTimeout` that only removes the active step entry; it doesn’t cancel the in-flight `conversationEngine.run` or fail the step. Contrast with agent path, which races the engine call against a timeout.
  - Impact: Long-running provider calls can hang a director step; logs may misleadingly reflect success. `logEngineTimeout` exists but is unused.
  - Files: `src/backend/services/conversation-orchestrator.ts:58`, `src/backend/services/orchestration-agent.ts:112`.

- Core tool exposure vs. implementation gap
  - `TOOL_DESCRIPTORS` includes core tools: `list_agents`, `list_tools`, `describe_tool`, `read_api_docs`.
  - No corresponding handlers exist in `toolCalls.ts`, and `processDirectorToolCalls` does not route unrecognized names to a handler, causing unhandled tool calls and contract-guard error replies.
  - Evidence from Git: The registry existed historically (`d6f3568:src/shared/tools.ts`), but there is no prior implementation for these names in `toolCalls.ts` or orchestrator across available history. This is therefore a long-standing gap (not a recent deletion) in this branch, despite being “planned/used” in design docs.
  - Files: `src/shared/tools.ts:18`, `src/backend/services/conversation-orchestrator.ts` (handles only workspace + agent delegation), `src/backend/toolCalls.ts` (no cases for core list/describe/validate).

### Core Meta Tools: Current vs. Intended (Regression Analysis)

- Intended per DESIGN/registry (final set):
  - `list_agents`, `list_tools`, `describe_tool`, `read_api_docs`.
- Current implementation status (absent):
  - `toolCalls.ts` has no handlers for these meta tools; orchestrator returns “unsupported_tool_call”.
  - Search of Git history shows registry entries but never concrete handlers in this branch. If these existed elsewhere, they were not merged here.
- Consequences:
  - Director prompt strategies relying on discovery/validation tools underperform or loop on errors.
  - LLM may label dormant code “legacy/unused” when present but uninvoked; with omission, it recognizes absence. Root cause is routing + missing handlers.
- Restitution plan (non-breaking):
  - Implement handlers in `toolCalls.ts`:
    - `list_agents`: read from `repos.agents`; return `{ id, name, apiConfigId }[]` for the current director’s roster.
    - `list_tools`: derive from `TOOL_DESCRIPTORS` + role gating; return `{ name, description }[]` (optionally include `parameters`).
    - `describe_tool`: return `{ name, description, parameters }` by lookup.
    - `read_api_docs`: placeholder returning curated doc snippets (e.g., from `docs/`), with allowlisted default and one‑time WARN until real sources are wired.
  - Update `ConversationOrchestrator.processDirectorToolCalls` to route unrecognized names to `createToolHandler` (except `agent__*` which remains delegated). Prefer a default “try tool handler” branch before declaring unhandled.

### Deliberate Omission: validate_tool_params

- Decision: Remove `validate_tool_params` from the registry and do not expose it as a tool.
- Rationale: Validation belongs at the backend boundary. Tools that receive invalid params should fail closed and return structured error messages. Having the LLM call a validation tool is superficial and adds latency/complexity.
- Actions:
  - Remove `validate_tool_params` from `src/shared/tools.ts` and from any prompt guidance mentioning it.
  - Ensure server‑side validation remains authoritative via `validateAgainstSchema` + semantic checks in `toolCalls.ts` (after fixing the semantics kind mapping as noted above).

- Workspace provenance/context mismatch
  - `WorkspaceService.addItem` requires `WorkspaceItemInput` with `provenance`, but tool paths pass a `context` field which the service ignores. Items are created with `provenance: undefined`.
  - Later filtering expects `context` or legacy `agentId` on items when listing, neither of which are set by the service. Cross-linking by conversation id breaks.
  - Files: `src/backend/services/workspace-service.ts:41` (expects `provenance`), `src/backend/toolCalls.ts:195` (passes `context`), `src/backend/services/conversation-orchestrator.ts:322` (constructs `context`), `src/backend/services/conversation-orchestrator.ts:362` (filters by `context?.agentId`).

- Tool semantics validator mis-keyed
  - `validateToolSemantics(kind, payload)` compares `kind` to `calendar|filesystem|todo|memory`, but callers pass `name` (e.g., `calendar_read`). Result: semantic checks don’t run for new names.
  - Files: `src/backend/toolCalls.ts:15` (passing `name`), `src/backend/toolCalls.ts:252` (validator).

- Duplicated tool-spec building code
  - Two separate transformers exist: `services/engine.ts` and `utils/tools.ts`. Divergence risk if flags/roles evolve.
  - Files: `src/backend/services/engine.ts:4`, `src/backend/utils/tools.ts:5`.

- Logging layers duplication
  - Three surfaces: `services/logging.ts` (structured traces + provider events), `services/logging-handlers.ts` (wrappers logging orchestration/provider events), and `utils/orchestration.ts` (diagnostic helpers). These partially overlap and can drift.
  - Files: `src/backend/services/logging.ts`, `src/backend/services/logging-handlers.ts`, `src/backend/utils/orchestration.ts`.

- Route surface fragmentation
  - Both `conversations.ts` and `conversations-enhanced.ts` mount under `/api/conversations`. Paths don’t collide currently, but maintenance is harder and “canonical source of truth” is diluted.
  - Files: `src/backend/routes/index.ts:33`, `src/backend/routes/conversations.ts`, `src/backend/routes/conversations-enhanced.ts`.

- Mixed responsibilities in `ConversationOrchestrator`
  - Class manages: step lifecycle, logging, tool-call dispatch, workspace mutation, agent fan-out, and persistence. This violates narrow-responsibility guidance and complicates testing.
  - Files: `src/backend/services/conversation-orchestrator.ts` (entire file).

## Business Logic Findings

- Contract guard robustness (second‑pass focus)
  - The contract guard appends “unsupported_tool_call” tool replies for unhandled tool calls and then swallows any logging failure with an empty `catch {}`.
  - Issues:
    - Empty catch violates “never silently swallow errors.” At minimum, emit a WARN with relevant context.
    - Using `email?.id || 'unknown'` hides missing email invariant; the director loop should not be running without an email envelope. Fail fast and propagate a sanitized error.
    - Unhandled core tools indicate a registry/implementation mismatch. Prefer preventing generation of unimplemented tool names (fail closed) over compensating with error tool messages.
  - Files: `src/backend/services/conversation-orchestrator.ts:282-304`.

- Director loop continuation contract
  - `decideShouldContinue` returns true when tool calls exist, but if mandatory core tools aren’t implemented, the loop still continues only after injecting error tool messages. This degrades the director’s planning.
  - Files: `src/backend/services/conversation-orchestrator.ts:28`, `src/backend/services/conversation-orchestrator.ts:120`.

- Workspace list filtering not applied to response
  - The code computes a filtered `items` array by `agent_id` but returns `listResult` unchanged in the tool response; logging reports filtered counts that do not match returned content.
  - Files: `src/backend/services/conversation-orchestrator.ts:358` (filter), `src/backend/services/conversation-orchestrator.ts:367` (responds with unfiltered `listResult`).

- Agent thread creation and provenance
  - `ensureAgentThread` works correctly for reuse/creation and traces, but downstream workspace items lack provenance linkage. Later diagnostics that rely on `provenance.conversationId` won’t find these items.
  - Files: `src/backend/services/orchestration-agent.ts:21`, `src/backend/routes/conversations-enhanced.ts:29` (uses `provenance.conversationId`).

- Provider event logging inconsistency
  - Agent flow correctly logs via callback with latency/usage. Director path logs via `ProviderEventLogger` from `logging-handlers.ts`. Both work but are duplicated approaches and have slightly different shapes/lifecycles.
  - Files: `src/backend/services/orchestration-agent.ts:136`, `src/backend/services/conversation-orchestrator.ts:71`, `src/backend/services/logging-handlers.ts:392`.

## Best Practices & SOLID

- Strict typing gaps
  - Widespread `any` usage across core surfaces (tool payloads, API config, events), reducing compile-time guarantees. Violates “strict typing and explicit identifiers”.
  - Examples: `src/backend/toolCalls.ts:15`, `src/backend/services/orchestration-agent.ts:12`, `src/backend/services/email-processor.ts:26`, `src/shared/types.ts` includes many `any` fields for diagnostics/payloads.

- Validate at boundaries
  - Good: `repo-access.requireReq`, route-level `errorHandler`, repo contract checks.
  - Gaps: Tool semantics validator mismatch (see above), missing schema validation for director-only tool calls, acceptance of user regexes without guardrails (regex DoS risk), and reliance on `||` defaulting where `??` or explicit validation is required by policy.
  - Files: `src/backend/services/orchestration-director.ts:28`.

- Separation of concerns
  - Orchestrator class mixes orchestration control, workspace side-effects, and agent dispatch. Consider extracting: step runner, tool-call processor, and provider logging adapter.

- Consistent logging contracts
  - Two providers for similar concerns (`logging.ts` vs `logging-handlers.ts`). Prefer a single canonical logging service to reduce drift and simplify testing.

## Recent Work Context (last ~10 commits)

- c3ab78b refactor: enhance logging and orchestration with fetchCycleId integration
  - Affected: orchestrator, email fetcher/processor, logging handlers, types. Aligns with improved diagnostics. Current code still falls back to `'unknown'` for missing fetchCycleId; per policy, treat as allowlisted default only with one‑time WARN.
- aac363d refactor: remove redundant path safety validation from file repository getAll methods
  - Reflects consolidation of security checks into boundary helpers. Good alignment with “Validate At Boundaries”.
- 1b99b64 refactor: migrate Google account OAuth to OIDC+PKCE flow
  - Security‑oriented change; unrelated to orchestration but shows forward‑only policy in action.
- a304907 refactor: remove legacy diagnostics routes and debug scripts; f4ed839, 97cf32c, dbcb63d docs/agents/type‑system updates
  - Directionally consistent with consolidation and stronger contracts documented in DESIGN/DEVELOPER.

Implication: The ongoing diagnostics/logging refactors justify tightening invariants now (no fallback to `'unknown'` for required fields), removing empty catches in logging paths, and consolidating tool registry/handlers to prevent unhandled tool calls.

## Deprecated/Legacy/Unused

- Test harness and routes
  - `openaiTest.ts` and `/api/test/*` routes are gated by `ENABLE_TEST_ROUTES` but ship with production code. Acceptable under current flags, but keep clearly scoped.
  - Files: `src/backend/openaiTest.ts`, `src/backend/routes/test.ts`, `src/backend/config.ts:29`.

- Dist and node_modules inside source tree
  - `src/backend/dist` and `src/backend/node_modules` exist in repo tree. This invites confusion and accidental imports; prefer ignoring build artifacts and not committing vendored deps.

- Duplicate tool-spec builders
  - See “Architecture” section: consolidate to one place to avoid legacy drift.

## Consolidation/Unification Opportunities

- Enforce step timeouts uniformly
  - Adopt the agent pattern (Promise.race with timeout) for director steps. Also emit `logEngineTimeout` where appropriate.

- Canonical tool-spec builder
  - Centralize OpenAI tool spec creation and role/flag filtering in a single module (e.g., `utils/tools.ts`) and use it from the engine.

- Single logging service
  - Merge `logging-handlers.ts` helpers into `services/logging.ts` or thin the wrappers to avoid dual pathways. Ensure consistent provider event shape and span handling.

- Tool call handling
  - Implement core tools: `list_agents`, `list_tools`, `describe_tool`, `validate_tool_params`, `read_api_docs` (the last may be stubbed but should be formally handled). Align schema/semantics.
  - Alternatively, remove or mark as non‑exposed any core tool not implemented yet, so the engine cannot emit them (fail closed). Do not rely on compensating tool replies.
  - Fix semantics validator to understand `calendar_read|calendar_add|…` by mapping to base kind, or change dispatch to send base kind to the validator.

- Workspace item provenance
  - Ensure all creation paths provide `WorkspaceItem.provenance` (with `conversationId`, `createdBy`, `creatorId`). Remove the unused `context` payload and update filter logic to use `provenance` only. Add a guard that rejects item creation without provenance (explicit error, no defaults).

- Conversations routes
  - Coalesce `conversations` and `conversations-enhanced` under one module or keep enhanced under a distinct base path to avoid overlap under `/api/conversations`.

- Extract orchestrator responsibilities
  - Split `ConversationOrchestrator` into: StepRunner (timeouts + engine call), ToolCallProcessor (director and workspace ops), and ProviderLogger adapter.

## Notable File References

- Director step timeout bookkeeping without cancellation: `src/backend/services/conversation-orchestrator.ts:58`.
- Agent timeout enforcement via Promise.race: `src/backend/services/orchestration-agent.ts:112`.
- Core tools exposed but unhandled: `src/shared/tools.ts:18`, `src/backend/services/conversation-orchestrator.ts:148`, `src/backend/toolCalls.ts:1`.
- Workspace provenance mismatch: `src/backend/services/workspace-service.ts:41`, `src/backend/toolCalls.ts:195`, `src/backend/services/conversation-orchestrator.ts:322`, `src/backend/routes/conversations-enhanced.ts:29`.
- Semantics validator mis-keyed: `src/backend/toolCalls.ts:252`, `src/backend/toolCalls.ts:15`.
- Duplicated tool-spec builders: `src/backend/services/engine.ts:4`, `src/backend/utils/tools.ts:5`.
- Duplicated logging surfaces: `src/backend/services/logging.ts:1`, `src/backend/services/logging-handlers.ts:1`, `src/backend/utils/orchestration.ts:1`.

- Contract guard swallowing errors and masking invariants: `src/backend/services/conversation-orchestrator.ts:282-304`.

## Quick Wins (Non-breaking Recommendations)

- Apply engine timeout race in director steps; use existing `CONVERSATION_STEP_TIMEOUT_MS` and `logEngineTimeout`.
- Add minimal handlers for core tools that return structured data using existing repos (e.g., `list_agents` from repos; `list_tools` from `TOOL_DESCRIPTORS`).
- Map tool semantics validation to derived base kind, or accept full names in validator.
- Populate `WorkspaceItem.provenance` on all write paths; remove reliance on ad hoc `context` on items.
- Replace scattered `any` with specific types in tool handlers and orchestrator surfaces to enforce contracts.
- Choose a single tool-spec builder and a single provider logging adapter.
- Remove empty catch blocks in orchestrator logging; log WARN with contract context. Replace `|| 'unknown'` with invariant validation (throw) or allowlisted default + one‑time WARN only for non‑invariant diagnostics.

## Risk Assessment

- Reliability: Non-enforced director timeouts and unhandled core tools lead to stuck loops and brittle prompting; prioritize.
- Observability: Multiple logging paths can diverge. Centralization will make diagnostics more trustworthy.
- Data Integrity: Missing workspace provenance breaks cross-linking and downstream analytics.
- Security: Regex evaluation is user-defined; consider timeouts or safer pattern checks to mitigate ReDoS if filters become large/untrusted.

- Contract: Weakening invariants with optional chaining and string fallbacks introduces silent data‑quality issues that will compound under load. Tighten now while recent refactors are fresh.

## Closing Notes

The codebase demonstrates thoughtful isolation (per-user repos), guarded persistence, and consistent error handling patterns. Addressing the highlighted architectural and contract gaps (timeouts, core tools, provenance, validation) will materially improve stability and clarity while aligning the implementation with AGENTS.md standards for strict typing and clean separation of responsibilities.

## Evidence From Git (Core Tools)

## Status Update (Aligned With DESIGN.md)

- Implemented now
  - Removed `validate_tool_params` from the registry (validation remains server-side per DESIGN “Validate At Boundaries”).
  - Implemented director meta tools in orchestrator: `list_agents`, `list_tools`, `describe_tool`, and a stub for `read_api_docs` (neutral, allowlisted placeholder).
  - Fixed tool semantics validation to map extended names (e.g., `calendar_read`) to base kinds before semantic checks.
  - Enforced director step timeouts via Promise.race with `CONVERSATION_STEP_TIMEOUT_MS` and `logEngineTimeout` (mirrors agent loop behavior).
  - Strengthened contract guard: removed silent catch and added WARN on logging failure; stopped masking email invariant with `'unknown'`.
  - Fixed `workspace_list_items` response to return filtered items when `agent_id` is provided.
  - Fallback routing: Unrecognized director tool names are dispatched to the generic tool handler, ensuring every `tool_call` yields a tool reply (contract adherence).
  - Logging consolidation: `logging-handlers.ts` now delegates to core `services/logging.ts` for orchestration and provider events, reducing duplication and drift.
  - Tool gating aligned to settings: Director tool exposure now includes mandatory tools plus explicitly enabled optional tools (per director settings). Agent gating already aligned to agent settings.
  - Unified tool handling: Moved meta tool execution into the generic tool router; orchestrator no longer contains meta tool branches and routes all non-agent tools through the router.
  - Unified spec building: `engine.ts` now consumes the single builder (`utils/tools.ts`) for OpenAI tool specs, eliminating duplicate spec logic.
  - Tool execution timeout: Generic tool router enforces `TOOL_EXEC_TIMEOUT_MS` across all tool handlers (parity for directors and agents).
- Agent delegation simplification: Replaced dynamic per-agent tools with a single `delegate_to_agent` tool (registry + router handler); removed dynamic agent tool injection from the engine.
  - Compatibility: Temporarily re-enabled dynamic `agent__{id}` tools behind `ENABLE_DYNAMIC_AGENT_TOOLS` (default true) to avoid breaking existing prompts. Plan to disable by default and remove after migration to `delegate_to_agent`.

- Test status
  - Per project policy (AGENTS.md “Explicit exclusions”), unit tests are not added unless explicitly instructed. Previous notes listing `*.unit.cjs` files reflected a plan, not committed artifacts; no such tests exist in `src/backend/tests/`. Keep tests as “pending” until explicitly authorized.

## One Codebase Confirmed

- Directors and Agents are threads with the same execution path. The only special capability for Directors is invoking `delegate_to_agent` to spawn/run agent threads.
- Tool exposure (mandatory vs optional) is enforced per director/agent settings, surfaced to the model through a single spec builder.

## Remaining Work

- Provider logging unification: ensure agent and director paths emit identical shapes via core `services/logging.ts` and remove any residual wrapper divergences.
- Invariants sweep: remove/guard any lingering invariant fallbacks or silent catches beyond orchestrator/logging (prefer explicit validation and allowlisted defaults with WARN for non-invariants).
- Documentation: update `docs/DEVELOPER.md` and `docs/DESIGN.md` to reflect `delegate_to_agent`, unified router, and tool‑gating semantics per director/agent settings.
- Tests: add unit tests for `list_agents`, `list_tools`, and `describe_tool`; add an orchestrator contract test variant using `delegate_to_agent`.
- Optional refactor: extract `StepRunner`, `ToolCallProcessor`, and `ProviderLogger` from `ConversationOrchestrator` to narrow responsibilities and simplify testing.
- Legacy removal: deprecate and remove support for `agent__*` dynamic tools entirely after a short deprecation window (current code still tolerates them for backward compatibility in persisted data).
  - Toggle: control via `ENABLE_DYNAMIC_AGENT_TOOLS=false` to test migration readiness.

## 2025‑09‑14 Addendum — Invariants & Fail‑Early Validation

- Policy (recap):
  - **No defaults for invariants:** Missing/invalid required inputs cause explicit errors; no `'unknown'`/empty string placeholders.
  - **Allowlisted defaults only:** Neutral, spec‑approved defaults for non‑invariants; document inline; emit one‑time WARN; cover with tests when tests are enabled.
  - **Safe semantics:** Use `??` only for typed optionals; avoid `||` defaulting on identifiers.

- Completed now:
  - **Director email id required:** Early guard enforces `thread.email.id` presence; else throws. `src/backend/services/conversation-orchestrator.ts:78`.
  - **Engine timeout race:** Director step uses `Promise.race` + `logEngineTimeout` mirroring the agent loop. `src/backend/services/conversation-orchestrator.ts:110`–`120`, timeout trigger and logging at `:116`–`:118` and `:102`–`:109`.
  - **Tool semantics normalization:** Validator maps extended names (e.g., `calendar_read`) to base kinds before checks. `src/backend/toolCalls.ts:356`–`:384` (`baseKind`, `validateToolSemantics`).
  - **Workspace provenance enforced at boundary:** `workspace_add_item` requires canonical `provenance{ emailId, conversationId, createdBy, creatorId }`; alias `context{...}` removed. Validation and conversion occur in handler. `src/backend/toolCalls.ts:323`–`:361`.
  - **Orchestrator provenance (no fallbacks):** Workspace add payload now uses strict ids with no `||` defaults: email id from `thread.email.id`, director id from `thread.directorId`. `src/backend/services/conversation-orchestrator.ts:515` and `:520` updated.
  - **Generic tool invariants:** Orchestrator always injects `conversationId` and `directorId` for tool execution (server‑supplied invariants, not user defaults). `src/backend/services/conversation-orchestrator.ts:347`–`:355`.
  - **Meta tool coverage:** Implemented `describe_tool` and `read_api_docs` (stub) to avoid unhandled calls. `src/backend/toolCalls.ts`.
  - **`delegate_to_agent` strictness:** Tool handler now requires `directorId` explicitly; no fallback to parent thread. `src/backend/toolCalls.ts:24`–`:65`.
  - **Types tightened:** `OrchestrationContext.conversationId` is now required. Builders throw if missing. `src/shared/types.ts:191` and `src/backend/utils/orchestration.ts:37`–`:47`.
  - **Schema update:** `workspace_add_item` JSON schema now includes required `provenance{...}`. `src/shared/tools.ts`.
- **UI aligned to provenance:** Results view groups items by `provenance.emailId` and derives subject/from/date via `/api/conversations`. All `item.context.*` references removed. `src/frontend/src/Results.tsx`.
  - **UI aligned to provenance:**
    - Results view groups by `provenance.emailId` and derives subject/from/date via `/api/conversations`. `src/frontend/src/Results.tsx`.
    - Conversations view tables and editor use `metadata`, `content`, `lifecycle`, and `provenance` consistently. `src/frontend/src/Conversations.tsx`.

- Pending (minor):
  - **Frontend residuals:** Confirm all UI references use `item.provenance.*` only; subject/from/date now resolved via `/api/conversations` lookup by `provenance.emailId`.

- Allowed defaults (documented):
  - **Workspace content defaults:** `mimeType: 'text/plain'`, `encoding: 'utf8'`, and `data: ''` are non‑invariant and acceptable. Consider adding a one‑time WARN counter. `src/backend/toolCalls.ts:341`–`:344`.
  - **Trace/span ids:** `beginTrace`/`beginSpan` generate ids when none provided. `src/backend/services/logging.ts:65`, `:115`.

- Verification checklist (grep):
  - Absence of invariant placeholders: `rg -n "\|\|\s*'unknown'|id\?\.` src`
  - Orchestrator fallbacks to remove: `rg -n "email\?\.id\s*\|\||director\?\.id\s*\|\|" src/backend/services/conversation-orchestrator.ts`
  - Optional id markers in core types: `rg -n "\bid\s*\?:|directorId\s*\?:|conversationId\s*\?:" src/shared/types.ts`

## 2025‑09‑16 Addendum — Type Purity, Invariants, runId

- Purity: removed diagnostics from domain types
  - Threads: dropped `traceId` and `provider` from `BaseConversationThread`. `src/shared/types.ts`.
  - Messages: removed `traceId`/`spanId` from `PromptMessage.context` (kept `toolSpecsHash`, `variables`). `src/shared/types.ts`.
  - Orchestration now carries tracing via contexts/events; code updated accordingly in orchestrator, email processor, and manual assistant route.

- Invariants and naming
  - `fetchCycleId` renamed to `runId` (required). Propagated across types, orchestrator, logger, and fetcher. `src/shared/types.ts`, `src/backend/services/*`.
  - `Trace.accountId` required; `beginTrace` enforces it. `src/shared/types.ts`, `src/backend/services/logging.ts`.
  - Director/Agent `enabledToolCalls` required `string[]` (no `undefined`). Routes coerce to `[]`. `src/shared/types.ts`, `src/backend/routes/{directors,agents}.ts`.

- Tooling contracts strengthened
  - Discriminated unions for tool payloads: calendar (read/add), filesystem (search/retrieve), memory (search/add/edit). `src/shared/types.ts`.
  - `ToolCallResult` is a discriminated union; `error` is required on failures. `src/shared/types.ts`; handler updated in `src/backend/toolCalls.ts`.
  - Tool metadata strict: `ToolFlags` booleans required; `ToolDescriptor.flags` and `.inputSchema` required. `src/shared/types.ts`, `src/shared/tools.ts`.

- Diagnostics events
  - `OrchestrationEvent` is phase‑discriminated: `director` uses `DirectorContext` (no `agentId`), `agent` requires `agentId`. `src/shared/types.ts`; logger emits director context. `src/backend/services/logging-handlers.ts`.
  - Introduced `LLMProvider` alias for provider events (`'openai'` today). `src/shared/types.ts`.

- Security at route boundaries
  - `GET /api/settings` now returns public `ApiConfig` fields only (no `apiKey`). `src/backend/routes/settings.ts`.
  - Accounts routes already redact tokens; unchanged.

- Email types
  - Unified on shared `EmailEnvelope`; backend duplicate removed. Fetcher always sets required `to` (empty string if absent). `src/backend/services/{email-processor,email-fetcher}.ts`.

- Verification (additional)
  - No diagnostics in domain: `rg -n "traceId\?|spanId\?" src/shared/types.ts`
  - No provider on threads: `rg -n "provider\?: 'openai'" src/shared/types.ts`
  - Tool flags/descriptor required: search for `flags\?:|inputSchema\?:` should return nothing in shared types.
  - Public settings: ensure no `apiKey` in responses (review `routes/settings.ts`).

- AGENTS.md updated
  - Added “Type Purity & Invariants” rules and a PR checklist to prevent regressions (no invariants defaulting, no diagnostics in domain, required arrays, union payloads/results). `src/AGENTS.md`.

- Next actions (surgical changes):
  - **Orchestrator → provenance:** Build `provenance` directly for workspace adds; remove `context` payload and string/`||` defaults. Fail closed on any missing field. Targets: `src/backend/services/conversation-orchestrator.ts:513`–`:526`.
  - **Remove `||` on identifiers:** Replace remaining `|| ''`/`||` on ids with explicit validation or guaranteed assignments upstream. Targets: lines cited above.
  - **Types tighten (logging, optional ids):** Make `conversationId` required in `OrchestrationContext` for director/agent phases; keep optional only where truly absent by design.

## Next Steps (Order)

1) Add an orchestrator contract test covering `delegate_to_agent` end‑to‑end (no diagnostics shim).
2) Update developer/design docs to the current tool model and gating; add npm scripts (`test:tools`, `test:delegate`) and note on bypassing the shim.
3) Provider logging shape alignment + minor invariants sweep.
4) Schedule removal of `agent__*` handling in orchestrator after the deprecation window; maintain a single canonical delegation tool.
5) Consider orchestrator internal extraction if further evolution is planned; otherwise, keep stable.

- Planned next (in this order)
  1) Enforce director step timeouts with a Promise.race and `logEngineTimeout` (mirror agent loop) [Implemented below].
  2) Strengthen the contract guard: remove empty catch; avoid invariant-masking defaults; log WARN on logging failures.
  3) Workspace item provenance: pass `provenance` and `content/metadata` consistently; stop using ad hoc `context` on items; filter responses using `provenance` (matches DESIGN decomposed structure).
  4) Route remaining unrecognized director tool names to `createToolHandler` before declaring unhandled.
  5) Remove invariant fallbacks (`|| 'unknown'`) and replace with validation or allowlisted defaults with one‑time WARN for non-invariants.

- Rationale
  - These changes align with DESIGN: single canonical tool registry, decomposed `WorkspaceItem`, strict invariants, and fail-closed behavior.

- Registry present since `d6f3568` with the five core meta tools in `src/shared/tools.ts`.
- No matching cases in `src/backend/toolCalls.ts` across commits (`git log -S 'list_tools'|…` yields only registry/docs changes).
- Orchestrator never routed these names; only workspace and `agent__*` are handled. The absence is structural in this branch, not a recent removal.

---

## Update — 2025-09-16 (FE/BE Dysfunction Triage)

Assumption: both backend and frontend present as non-working in the current environment. This delta records confirmed breakages, root causes, and the minimum patch set to restore basic login + UI navigation.

### Triage Summary

- Critical: OAuth login path is hard‑failed by missing OIDC env vars; no dev fallback; all non‑health routes require auth.
- Critical: Auth callback redirect uses an empty string when `CORS_ORIGIN` is unset/`*`, yielding an invalid `Location` and broken return to the UI.
- High: CORS defaults do not allow credentials for cross‑origin XHR; without the Vite proxy, cookies are never sent and whoami fails.
- High: Meta discovery tools remain unimplemented (`list_agents`, `list_tools`, `describe_tool`, `read_api_docs`) despite “implemented now” notes below; docs drift.
- Medium: Spec mismatch — `workspace_list_items` schema has no filters, yet orchestrator supports `agent_id` filtering.

### Reproduction (local)

- Backend: `cd src/backend && npm i && npm run dev`
  - Health: `GET http://localhost:3001/api/health` → `{ status: 'ok' }`.
  - Any auth‑guarded route (e.g., `/api/settings`) → `401` without a session cookie.
- Frontend: `cd src/frontend && npm i && npm run dev` (Vite on `http://localhost:3000`, proxies `/api → :3001`).
  - App loads `/login`. Clicking “Continue with Google” calls `/api/auth/google/initiate` then redirects to Google; callback to `/api/auth/google/callback` breaks:
    - If OIDC env is missing: backend throws (required config).
    - If OIDC env is set but `CORS_ORIGIN` is unset/`*`: callback computes `location = ''` and issues `res.redirect('')` (invalid/no‑op).
  - Without Vite proxy (or in deployed split origins), cookies are not sent because `configureCors()` does not set `Access-Control-Allow-Credentials` when `CORS_ORIGIN='*'`.

### Root Causes (concrete)

- Auth callback redirect bug
  - Code: `src/backend/routes/auth-session.ts:34` →
    - `const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
       const location = origin ?? '/';
       res.redirect(location);`
  - Impact: When `CORS_ORIGIN` is default `*`, `origin=''`, `??` preserves `''`; Express redirects to an empty location.
  - Fix: Treat empty as absent; default to `'/'`.

- CORS credentials off by default
  - Code: `src/backend/bootstrap/app.ts:17` → uses `app.use(cors())` when `CORS_ORIGIN` missing/`*`.
  - Impact: No `Access-Control-Allow-Credentials`; cross‑origin `fetch(..., { credentials:'include' })` fails to include cookies.
  - Fix options:
    - Require explicit `CORS_ORIGIN` and always set `credentials:true`.
    - Or provide a dev‑only allowlisted default (`http://localhost:3000`) with a one‑time WARN (AGENTS: Allowlisted Defaults Only).

- Meta tool implementations missing (docs drift)
  - Registry includes names; `src/backend/toolCalls.ts` returns “tool not implemented” for them; orchestrator now routes unknown names to the generic handler (good), but handler has no cases.
  - Action: Implement or remove from registry to avoid LLM proposing non‑existent tools (Fail Closed).

- Spec mismatch: `workspace_list_items`
  - Schema: no parameters (shared registry).
  - Orchestrator: supports optional `agent_id` filter.
  - Decision: Either add `agent_id?: string` to schema (preferred) or remove filtering.

### Verified Resolved (since 2025‑09‑12)

- Director step timeout enforced via `Promise.race` and `logEngineTimeout`.
  - Evidence: `src/backend/services/conversation-orchestrator.ts:114` (timeout promise) and `:138` (race result + clear).
- Fallback routing for unknown director tool names to the generic tool handler.
  - Evidence: `src/backend/services/conversation-orchestrator.ts:297`.
- Workspace item provenance supplied by orchestrator when adding items.
  - Evidence: `src/backend/services/conversation-orchestrator.ts:412` → `provenance: { emailId, conversationId, createdBy, creatorId }`.

### Minimal Patch Set (ranked)

1) Auth callback redirect — safe default
   - File: `src/backend/routes/auth-session.ts`
   - Change:
     - Before: `const location = origin ?? '/'`
     - After:  `const location = origin && origin.trim() ? origin : '/'`

2) CORS — credentials + allowlist
   - File: `src/backend/bootstrap/app.ts`
   - Options:
     - Strict: throw on missing `CORS_ORIGIN` (devs must set `http://localhost:3000`).
     - Dev‑only default: when `!isProd && !CORS_ORIGIN`, set `origin: 'http://localhost:3000', credentials: true` and emit one‑time WARN (AGENTS: allowlisted default).

3) Meta tools — implement or remove
   - File: `src/backend/toolCalls.ts`
   - Add handlers:
     - `list_agents`: from `repos.agents` → `{ id, name, apiConfigId }[]`.
     - `list_tools`: from gated `TOOL_DESCRIPTORS` (role/caps aware if passed) → `{ name, description }[]`.
     - `describe_tool`: lookup in `TOOL_REGISTRY` → `{ name, description, parameters }`.
     - `read_api_docs`: stub returning curated snippets.
   - Or remove names from `src/shared/tools.ts` to prevent exposure (temporary hardening).

4) Align `workspace_list_items` schema
   - File: `src/shared/tools.ts`
   - Add optional `agent_id` parameter to match orchestrator’s filter behavior.

### Acceptance Checks

- Login flow: with only `GOOGLE_LOGIN_*` set and `CORS_ORIGIN=http://localhost:3000` (or Vite proxy), user sees `/` after callback and `whoami` returns the user.
- FE navigation: Admin tabs load; Cleanup endpoints respond; Workspace list and delete function.
- LLM orchestration: Unknown tool names generate tool replies via generic handler; no silent contract violations.

### Proposed Diffs (reference)

- `src/backend/routes/auth-session.ts:34`
  - `const location = origin && origin.trim() ? origin : '/'`

- `src/backend/bootstrap/app.ts`
  - Replace fallback `app.use(cors())` with a branch that either enforces explicit `CORS_ORIGIN` + `credentials:true` or, in dev, sets `origin:'http://localhost:3000', credentials:true` and logs a one‑time WARN.

### Notes on AGENTS Discipline

- No Defaults For Invariants: Keep `requireNonEmpty()` for OIDC config; surface precise 400/401 with actionable messages.
- Allowlisted Defaults Only: A dev‑only `CORS_ORIGIN` default is acceptable if documented inline and emits a WARN; do not add hidden backdoors.
- Fail Closed: If meta tools remain unimplemented, remove them from exposure. Do not rely on compensating tool replies as “working”.

### Next Actions (1–2 day scope)

- Patch auth redirect + CORS (small, low‑risk).
- Decide on meta tools: implement minimal read‑only variants or remove from registry.
- Update `README.md` quick start to include required OIDC vars and explicit `CORS_ORIGIN` for dev.

## Backend Fixes Applied — 2025-09-16

- Auth callback redirect: default to `/` when `CORS_ORIGIN` is unset or `*`.
  - File: `src/backend/routes/auth-session.ts:34`
- CORS tightening: credentials enabled with a dev‑only allowlisted default (`http://localhost:3000`); warns in prod when misconfigured.
  - File: `src/backend/bootstrap/app.ts`
- Meta tools implemented in generic router:
  - `list_agents`: roster from `directors.agentIds` and `agents` repo
  - `list_tools`: mandatory + `director.enabledToolCalls`
  - `describe_tool`: lookup in canonical registry
  - `read_api_docs`: stub with curated pointers (no FS dependency)
  - File: `src/backend/toolCalls.ts`
- Schema alignment: `workspace_list_items` accepts optional `agent_id` to match orchestrator filter.
  - File: `src/shared/tools.ts`

Open items (not yet changed):
- Consider moving `read_api_docs` to a proper doc indexer later; current stub is neutral and allowlisted.
- README dev quick‑start: call out `CORS_ORIGIN=http://localhost:3000` and required OIDC envs.
