# Backend Code Quality Audit — 2025-09-22

## Findings

### Architecture/Design
- **Config defaults bypass required secrets (Critical):**
  **Evidence:** `src/backend/config.ts:13-75,172-199` uses `getOptionalEnv`/`getOptionalIntEnv` to supply empty strings or test defaults for `VX_MAILAGENT_KEY`, `JWT_SECRET`, OAuth credentials, and timeout values, allowing startup with missing invariants.
  **Defect Hypothesis:** The config producer emits blank secrets, so downstream crypto, JWT, and OAuth code operate without required keys, forcing plaintext persistence and exposing authentication endpoints to misconfiguration.
  **SOT Declaration:** `process.env` as read through `src/backend/config.ts` is the authoritative source for secrets and runtime limits.
  **Recommended Repair (producer-only):** Replace optional getters with `requireEnv` variants for non-optional keys, throw on missing values regardless of environment, and drop the non-production bypass in `warnIfInsecure` so the backend fails closed.
  **Exit Criteria:** Boot with missing `VX_MAILAGENT_KEY` or `JWT_SECRET` aborts immediately with a descriptive error; successful boot logs confirm 64-char key and non-default JWT secret; OAuth flows succeed with validated credentials.
  **Side effects/Risks:** Stricter validation will break dev setups lacking env files—coordinate with tooling to inject fixtures or document required exports.

### Business Logic
- **Agent orchestrator drops API secrets (Critical):**
  **Evidence:** `src/backend/services/conversation-orchestrator.ts:709-718` passes `apiConfig.apiKey` (string) to `runAgentConversation`, but `runAgentConversation` expects `{ apiKey }` (`src/backend/services/orchestration-agent.ts:85-123`); `conversationEngine.run` subsequently receives `secrets?.apiKey` as `undefined`, throwing `Missing API key` and forcing every agent workspace tool call to fail.
  **Defect Hypothesis:** Producer `executeAgentConversation` mis-shapes the secrets payload, so the agent conversation engine never receives credentials and aborts each run.
  **SOT Declaration:** `settings.apiConfigs[*].apiKey` persisted via repositories is the authoritative API secret for agent conversations.
  **Recommended Repair (producer-only):** Wrap the secret before invocation (`runAgentConversation(..., { apiKey: apiConfig.apiKey }, ...)`) and add a guard that rejects when `apiConfig.apiKey` is absent instead of silently logging.
  **Exit Criteria:** Workspace add/list flows spawn agents that complete without `Missing API key` errors; regression tests confirm agent responses persist in conversation threads.
  **Side effects/Risks:** Expect tighter validation to surface improperly seeded apiConfigs; ensure fixtures contain realistic keys.

- **list_tools falls back to mandatory set on missing entity (High):**
  **Evidence:** `src/backend/toolCalls.ts:49-69` calls `selectToolDescriptors('director', dir?.enabledToolCalls || [])` and `selectToolDescriptors('agent', ag?.enabledToolCalls || [])`; when a provided directorId/agentId is not found, the allowlist null-coalesces to `[]`, so the response quietly exposes mandatory tools instead of failing.
  **Defect Hypothesis:** The tool registry producer synthesizes visibility data when the entity lookup fails, letting callers bypass allowlists and masking repository drift.
  **SOT Declaration:** Director and agent allowlists stored in per-user repositories via `repos.directors`/`repos.agents` govern tool exposure.
  **Recommended Repair (producer-only):** When directorId or agentId is supplied but missing, return `{ success: false, error: 'director_not_found' | 'agent_not_found' }` rather than defaulting; reuse existing repository errors for consistency.
  **Exit Criteria:** Invoking `list_tools` with an unknown entity ID produces an explicit error and no tool descriptors; valid IDs continue to honor allowlists.
  **Side effects/Risks:** Callers relying on the fallback will now see hard failures—audit frontend/tooling flows before rollout.

### Best Practices & SOLID
- **Agent CRUD masks missing enabledToolCalls (Medium):**
  **Evidence:** `src/backend/routes/agents.ts:20-41` feeds sanitized values through `sanitizeEnabled`, then coerces non-array inputs to `[]`, despite `Agent.enabledToolCalls` being required (`src/shared/types.ts:256-262`).
  **Defect Hypothesis:** The CRUD producer backfills a default array, allowing agents without intentional allowlists and hiding malformed payloads.
  **SOT Declaration:** Agent definitions persisted through `repos.getAgents`/`setAgents` are the canonical record of tool permissions.
  **Recommended Repair (producer-only):** Treat `sanitizeEnabled` returning `undefined` as validation failure; require callers to send an explicit array (even empty) and reject non-array inputs with actionable errors.
  **Exit Criteria:** Creating or updating an agent without `enabledToolCalls` yields a 400/ValidationError; stored agents always reflect caller-provided allowlists.
  **Side effects/Risks:** Client code that omitted the field must be updated; communicate schema change and add contract tests.

### Deprecated/Unused
- **None observed:** No deprecated or unused backend modules surfaced during this sweep; re-run the audit after addressing the above producers to confirm no legacy paths remain.

## Consolidation Proposals
1. **Centralize tool allowlist validation in `selectToolDescriptors`:** Introduce an explicit `requireEntityAllowlist` flag so both orchestration and tool handlers share strict failure semantics. *Trade-off:* Requires refactoring call sites but removes duplicated nullish checks; migration limited to backend TypeScript modules.
2. **Unify secret handling via a typed `ApiSecrets` value object:** Supply constructors in the config layer and inject the object throughout orchestration/engine paths. *Trade-off:* Medium refactor touching providers and tests; simplifies future provider integrations and enforces typing at module boundaries.

## Follow-ups
- **Schema audit for other silent defaults:** Extend the search for `|| []`/`?? ''` beyond the highlighted areas to ensure no remaining producers mask invariants.
