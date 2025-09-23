## Findings

### Architecture/Design
- **Tool config persistence lacks invariant enforcement (High) — Resolved 2025-09-23:**
  - **Resolution Evidence:** `src/backend/routes/directors.ts` and `src/backend/routes/agents.ts` now reject empty allowlists while `src/backend/storage/sqlite/repositories/directors.ts` / `agents.ts` validate via `tool-config-service` before writes.
  - **Outcome:** Invalid `enabledToolCalls` can no longer reach persistence; orchestrator receives validated configs only.
  - **Residual Risk:** Legacy archives under `data/legacy/` remain out of scope per Caesar; any future migrations must seed compliant tool lists.

- **Tool config resolution still replicated across ingestion paths (Medium):**
  - **Evidence:** `src/backend/toolCalls.ts:51-183` reaches into repositories directly and resolves tool descriptors independently of orchestration.
  - **Defect Hypothesis:** Multiple consumers duplicate resolution logic; any future policy change must touch each site, risking drift.
  - **SOT Declaration:** `tool-config-service` should become canonical source for descriptor resolution across routes, orchestration, and tool meta handlers.
  - **Recommended Repair (producer-only):** Extend the new resolver so `toolCalls.ts` uses repository accessors that already enforce invariants instead of re-fetching raw rows, keeping a single codepath.
  - **Exit Criteria:** Tool descriptor selection (`list_tools`, delegation helpers, orchestrator) is routed exclusively through `tool-config-service`; no ad-hoc repo reads remain.
  - **Side Effects/Risks:** Requires wiring resolver dependencies into meta-tool handlers; risk of introducing circular deps if not isolated.

### Business Logic
- **Workspace tool result fallback (Medium):**
  - **Evidence:** `src/backend/services/conversation-orchestrator.ts:681` spreads `(addResult.result || {})`, masking null tool payloads.
  - **Defect Hypothesis:** Workspace tool handlers that omit `result` quietly produce empty updates, letting producers hide missing data.
  - **SOT Declaration:** Workspace tool handler response (`WorkspaceService` persistence).
  - **Recommended Repair (producer-only):** Validate handler output and throw when `result` is absent so the producer fails instead of returning empty items.
  - **Exit Criteria:** Null or undefined `result` now raises an orchestration error before any workspace mutation.
  - **Side Effects/Risks:** Increased operational failures until handlers comply; needs telemetry.

- **Accounts route body default (High):**
  - **Evidence:** `src/backend/routes/accounts.ts:107` casts `(req.body || {})` to `Partial<Account>` before validation.
  - **Defect Hypothesis:** Producer route accepts empty payloads, letting persistence write incomplete account rows.
  - **SOT Declaration:** `accounts` repository (`LiveRepos.accounts`).
  - **Recommended Repair (producer-only):** Validate request body fields before casting; reject missing invariants with explicit 400 errors.
  - **Exit Criteria:** Submitting account routes without mandatory fields returns a descriptive client error; no repo writes occur.
  - **Side Effects/Risks:** Clients relying on permissive behavior must correct payloads.

- **Conversation timestamp fallback (Medium):**
  - **Evidence:** `src/backend/routes/conversations.ts:146-147` falls back from `lastActiveAt` to `startedAt` using `||`.
  - **Defect Hypothesis:** Missing timestamps escape detection, allowing ordering to proceed on partial data rather than failing.
  - **SOT Declaration:** `conversations` repository timestamps.
  - **Recommended Repair (producer-only):** Guarantee both timestamps are written by conversation mutation helpers; reject repo rows lacking them before response assembly.
  - **Exit Criteria:** Fetching conversations with missing timestamps throws, prompting data remediation.
  - **Side Effects/Risks:** Legacy rows must be audited; user listings may error until fixed.

- **Prompt role coercion (Medium):**
  - **Evidence:** `src/backend/utils/prompt-helpers.ts:18` derives `String(payload.target.role || '').toLowerCase()`.
  - **Defect Hypothesis:** Missing roles convert to empty strings, bypassing validation and polluting prompt contexts.
  - **SOT Declaration:** `prompts` repository entries.
  - **Recommended Repair (producer-only):** Validate `payload.target.role` before coercion and throw if absent or invalid.
  - **Exit Criteria:** Prompt helper invocation with missing `role` rejects before lowercasing.
  - **Side Effects/Risks:** Existing callers must supply explicit roles.

### Best Practices & SOLID
- **Tool resolution boundary still leaks into meta-tools (Medium):**
  - **Evidence:** `src/backend/toolCalls.ts:51-183` manually instantiates tool descriptors after raw repo reads instead of delegating to the resolver abstraction.
  - **Defect Hypothesis:** Although orchestration now depends on `tool-config-service`, helper routes still reimplement descriptor logic, keeping DIP violations alive outside the orchestrator.
  - **SOT Declaration:** `tool-config-service` (single source for descriptor resolution).
  - **Recommended Repair (producer-only):** Expose resolver methods that accept repo interfaces or validated DTOs so meta-tools can request descriptors without direct schema knowledge.
  - **Exit Criteria:** `toolCalls.ts` stops touching `enabledToolCalls` arrays directly; it consumes validated descriptors from the shared service.
  - **Side Effects/Risks:** Requires light refactor of tool meta-handlers; minimal runtime risk once wired.

- **Logger metadata fallback (Medium):**
  - **Evidence:** `src/backend/services/logger.ts:40` merges `meta || {}` into `Object.assign`.
  - **Defect Hypothesis:** Logging pipeline accepts missing metadata and silently substitutes empty objects, eroding diagnostics integrity.
  - **SOT Declaration:** Logging service (`ProviderEventLogger` pipeline, SQLite logs).
  - **Recommended Repair (producer-only):** Enforce schema validation for metadata and reject empty values at logger entry.
  - **Exit Criteria:** Logger calls without required metadata immediately throw.
  - **Side Effects/Risks:** Reveals hidden instrumentation gaps; may fail noisy callers until addressed.

- **Logger annotation mutation (Low):**
  - **Evidence:** `src/backend/services/logging.ts:181` mutates `s.annotations` via `Object.assign({}, s.annotations || {}, annotations)`.
  - **Defect Hypothesis:** Logging service rewrites domain annotations instead of requiring producers to supply complete records.
  - **SOT Declaration:** Logging annotations persisted with provider traces.
  - **Recommended Repair (producer-only):** Demand immutable annotation input and remove mutation logic, rejecting incomplete payloads.
  - **Exit Criteria:** Attempting to log without full annotation data fails immediately.
  - **Side Effects/Risks:** Minor refactors at call sites.

### Deprecated/Unused
- **Gmail MIME default (Medium):**
  - **Evidence:** `src/backend/providers/mail/gmail.ts:73` assigns `const mimeType = part.mimeType || ''`.
  - **Defect Hypothesis:** Gmail ingestion hides missing MIME types, persisting empty strings instead of failing.
  - **SOT Declaration:** Gmail ingestion pipeline (`workspaceItems` persisted mail bodies).
  - **Recommended Repair (producer-only):** Validate `mimeType` and reject Gmail parts lacking the field before persistence.
  - **Exit Criteria:** Ingestion attempts with missing MIME values fail closed and log actionable errors.
  - **Side Effects/Risks:** Some malformed emails may be dropped pending remediation.

## Consolidation Proposals
1. **Complete tool resolver adoption:** Extend `tool-config-service` to cover meta-tools and repository writes so descriptor logic lives in one module. Trade-off: adjusts handler dependencies; payoff is uniform policy enforcement.
2. **Shared logging contract guard:** Define a schema-validated logger entry wrapper that all producers must use before hitting `ProviderEventLogger`. Trade-off: requires updating many call sites; ensures consistent diagnostics.
3. **Gmail ingestion schema enforcement:** Add a pre-persistence Gmail part validator module shared across mail providers. Trade-off: may surface more ingestion failures; improves data quality.

## Follow-Ups
1. Audit existing director and agent rows for missing or empty `enabledToolCalls` prior to enforcement.
2. Inspect conversation records to verify `lastActiveAt`/`startedAt` integrity before enabling strict validation.
