## Findings

### Architecture/Design
- **Conversation repo drops undefined message batches (High):**
  - **Evidence:** `src/backend/liveRepos.ts:130-143` `messages: [...current.messages, ...(messages || [])]`
  - **Defect Hypothesis:** The conversation repository treats missing tool outputs as empty arrays, so orchestrator/tool handlers that fail to return messages silently no-op instead of surfacing broken producers.
  - **SOT Declaration:** SQLite `conversation_threads`/`conversation_messages` via `LiveRepos.appendMessagesToConversation`.
  - **Recommended Repair (producer-only):** Require `appendMessagesToConversation` to receive a non-empty array and throw on undefined/null; update orchestrator tool handlers so they either provide concrete tool replies or propagate the error.
  - **Exit Criteria:** Calls supplying `undefined`, non-arrays, or empty batches throw before any persistence; valid tool replies still append and update `lastActiveAt`.
  - **Side effects/Risks:** Expect latent tool bugs to surface as hard failures until producers are corrected.

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
- **OAuth refresh retains stale refreshToken (Critical):**
  - **Evidence:** `src/backend/services/account-manager.ts:57-71` `refreshToken: refreshResult.refreshToken || account.tokens.refreshToken` — `src/backend/services/account-manager.ts:132-138` `refreshToken: refreshResult.refreshToken || accounts[accountIndex].tokens.refreshToken`
  - **Defect Hypothesis:** Provider refresh calls that omit a refresh token silently reuse the old value, so the producer persists stale credentials and the next refresh cycle fails without clear remediation.
  - **SOT Declaration:** Per-user `accounts` repository via `AccountManager.persistTokenUpdate`.
  - **Recommended Repair (producer-only):** Validate refresh responses before mutation; throw when `refreshResult` lacks non-empty `accessToken`, `refreshToken`, or `expiry` so the refresh pipeline fails closed and surfaces re-auth requirements.
  - **Exit Criteria:** Refresh attempts missing any required token field abort and return explicit errors; no persistence occurs.
  - **Side effects/Risks:** Gmail/Outlook providers may need updates/tests; rollout may surface expired tokens requiring user action.

- **Filter evaluation masks missing context (High):**
  - **Evidence:** `src/backend/services/orchestration-director.ts:29-35` `fieldValue = ctx.from ?? ''`
  - **Defect Hypothesis:** When ingestion drops required email fields, director filters substitute empty strings, letting conversation triggers proceed on partial data instead of failing fast.
  - **SOT Declaration:** Email envelopes stored via `EmailProcessor` (`emails` repository).
  - **Recommended Repair (producer-only):** Enforce validated `EmailContext` before filter execution; throw when mandatory fields (`from`, `subject`, `date`, recipients) are missing so ingestion halts prior to thread creation.
  - **Exit Criteria:** `evaluateFilters` raises an exception whenever any required email field is absent, preventing director trigger creation.
  - **Side effects/Risks:** Legacy mail archives with incomplete metadata may require remediation before reprocessing.

- **Agent handoff loses user content (High):**
  - **Evidence:** `src/backend/utils/message-transformers.ts:63-65` `return lastUserMessage?.content ?? ''` — `src/backend/services/conversation-orchestrator.ts:244-253` `const userContent = extractLastUserContent(thread.messages as any);`
  - **Defect Hypothesis:** Agent threads without a user message receive an empty string as the kickoff prompt, masking corrupted transcripts and producing useless completions.
  - **SOT Declaration:** `conversation_threads` transcript managed through `LiveRepos`.
  - **Recommended Repair (producer-only):** Make `extractLastUserContent` fail when no user message exists; propagate the validation error through `runAgentAssistant` so the orchestrator aborts instead of inventing content.
  - **Exit Criteria:** Agent orchestration aborts with a clear validation error when no user message is present; valid threads continue unaffected.
  - **Side effects/Risks:** Exposes legacy threads created before timestamp enforcement; expect targeted cleanup.

- **Workspace tool result fallback (Medium):**
  - **Evidence:** `src/backend/services/conversation-orchestrator.ts:710` spreads `(addResult.result || {})`, masking null tool payloads.
  - **Defect Hypothesis:** Workspace tool handlers that omit `result` quietly produce empty updates, letting producers hide missing data.
  - **SOT Declaration:** Workspace tool handler response (`WorkspaceService` persistence).
  - **Recommended Repair (producer-only):** Validate handler output and throw when `result` is absent so the producer fails instead of returning empty items.
  - **Exit Criteria:** Null or undefined `result` now raises an orchestration error before any workspace mutation.
  - **Side effects/Risks:** Increased operational failures until handlers comply; needs telemetry.

- **Accounts route body default (High):**
  - **Evidence:** `src/backend/routes/accounts.ts:107` casts `(req.body || {})` to `Partial<Account>` before validation.
  - **Defect Hypothesis:** Producer route accepts empty payloads, letting persistence write incomplete account rows.
  - **SOT Declaration:** `accounts` repository (`LiveRepos.accounts`).
  - **Recommended Repair (producer-only):** Validate request body fields before casting; reject missing invariants with explicit 400 errors.
  - **Exit Criteria:** Submitting account routes without mandatory fields returns a descriptive client error; no repo writes occur.
  - **Side effects/Risks:** Clients relying on permissive behavior must correct payloads.

- **Conversation timestamp fallback (Medium):**
  - **Evidence:** `src/backend/routes/conversations.ts:146-147` falls back from `lastActiveAt` to `startedAt` using `||`.
  - **Defect Hypothesis:** Missing timestamps escape detection, allowing ordering to proceed on partial data rather than failing.
  - **SOT Declaration:** `conversations` repository timestamps.
  - **Recommended Repair (producer-only):** Guarantee both timestamps are written by conversation mutation helpers; reject repo rows lacking them before response assembly.
  - **Exit Criteria:** Fetching conversations with missing timestamps throws, prompting data remediation.
  - **Side effects/Risks:** Legacy rows must be audited; user listings may error until fixed.

- **Prompt role coercion (Medium):**
  - **Evidence:** `src/backend/utils/prompt-helpers.ts:18` derives `String(payload.target.role || '').toLowerCase()`.
  - **Defect Hypothesis:** Missing roles convert to empty strings, bypassing validation and polluting prompt contexts.
  - **SOT Declaration:** `prompts` repository entries.
  - **Recommended Repair (producer-only):** Validate `payload.target.role` before coercion and throw if absent or invalid.
  - **Exit Criteria:** Prompt helper invocation with missing `role` rejects before lowercasing.
  - **Side effects/Risks:** Existing callers must supply explicit roles.

### Best Practices & SOLID
- **OpenAI provider coerces missing assistant text to empty string (Medium):**
  - **Evidence:** `src/backend/providers/openai.ts:33-46` `const content = choice?.message?.content ?? ''` — `src/backend/openaiTest.ts:13-26` `content: (m as any).content ?? ''`
  - **Defect Hypothesis:** Provider responses that legitimately omit `content` (tool-only turns, streaming gaps) are rewritten to empty strings, erasing signal that the assistant returned no text and encouraging downstream defaults.
  - **SOT Declaration:** Provider response wrapper used by `conversationEngine` and `/api/test` routes.
  - **Recommended Repair (producer-only):** Preserve `null` when OpenAI omits text; adjust consumers to treat `null` as “tool-only” instead of fabricating empty content.
  - **Exit Criteria:** `ChatCompletionResult.content` and test helpers keep `null` when the provider sends tool calls only; orchestrator surfaces missing content explicitly.
  - **Side effects/Risks:** UI surfaces may need to handle `null` instead of empty strings; telemetry should confirm no regressions.

- **Tool resolution boundary still leaks into meta-tools (Medium):**
  - **Evidence:** `src/backend/toolCalls.ts:51-183` manually instantiates tool descriptors after raw repo reads instead of delegating to the resolver abstraction.
  - **Defect Hypothesis:** Although orchestration now depends on `tool-config-service`, helper routes still reimplement descriptor logic, keeping DIP violations alive outside the orchestrator.
  - **SOT Declaration:** `tool-config-service` (single source for descriptor resolution).
  - **Recommended Repair (producer-only):** Expose resolver methods that accept repo interfaces or validated DTOs so meta-tools can request descriptors without direct schema knowledge.
  - **Exit Criteria:** `toolCalls.ts` stops touching `enabledToolCalls` arrays directly; it consumes validated descriptors from the shared service.
  - **Side effects/Risks:** Requires light refactor of tool meta-handlers; minimal runtime risk once wired.

- **Logger metadata fallback (Medium):**
  - **Evidence:** `src/backend/services/logger.ts:40` merges `meta || {}` into `Object.assign`.
  - **Defect Hypothesis:** Logging pipeline accepts missing metadata and silently substitutes empty objects, eroding diagnostics integrity.
  - **SOT Declaration:** Logging service (`ProviderEventLogger` pipeline, SQLite logs).
  - **Recommended Repair (producer-only):** Enforce schema validation for metadata and reject empty values at logger entry.
  - **Exit Criteria:** Logger calls without required metadata immediately throw.
  - **Side effects/Risks:** Reveals hidden instrumentation gaps; may fail noisy callers until addressed.

- **Logger annotation mutation (Low):**
  - **Evidence:** `src/backend/services/logging.ts:181` mutates `s.annotations` via `Object.assign({}, s.annotations || {}, annotations)`.
  - **Defect Hypothesis:** Logging service rewrites domain annotations instead of requiring producers to supply complete records.
  - **SOT Declaration:** Logging annotations persisted with provider traces.
  - **Recommended Repair (producer-only):** Demand immutable annotation input and remove mutation logic, rejecting incomplete payloads.
  - **Exit Criteria:** Attempting to log without full annotation data fails immediately.
  - **Side effects/Risks:** Minor refactors at call sites.

### Deprecated/Unused
- **Gmail MIME default (Medium):**
  - **Evidence:** `src/backend/providers/mail/gmail.ts:73` assigns `const mimeType = part.mimeType || ''`.
  - **Defect Hypothesis:** Gmail ingestion hides missing MIME types, persisting empty strings instead of failing.
  - **SOT Declaration:** Gmail ingestion pipeline (`workspaceItems` persisted mail bodies).
  - **Recommended Repair (producer-only):** Validate `mimeType` and reject Gmail parts lacking the field before persistence.
  - **Exit Criteria:** Ingestion attempts with missing MIME values fail closed and log actionable errors.
  - **Side effects/Risks:** Some malformed emails may be dropped pending remediation.

## Consolidation Proposals
1. **Guard transcript mutations at the repository boundary:** Introduce a single `appendMessagesStrict` helper that validates payload shape before delegating to SQLite. Trade-off: short-term failures until producers conform; payoff is uniform transcript integrity.
2. **Centralize email envelope validation before orchestration:** Share the `createEmailEnvelope` contract with `evaluateFilters` so every ingestion path enforces identical field checks. Trade-off: additional plumbing for context builders; payoff is consistent fail-closed behavior.
3. **Normalize provider response handling in one adapter:** Wrap OpenAI/chat completions (runtime + test) in a dedicated adapter that preserves nullable content and tool-only turns. Trade-off: minor refactor of orchestrator/test callers; payoff is a single place to evolve provider contract enforcement.

## Follow-Ups
1. Audit existing conversation threads for missing user messages or zero-length tool replies before enabling strict guards.
2. Audit existing director and agent rows for missing or empty `enabledToolCalls` prior to enforcement.
3. Inspect conversation records to verify `lastActiveAt`/`startedAt` integrity before enabling strict validation.
