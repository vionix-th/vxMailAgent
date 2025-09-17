# Audit Remediation TODO

1. ✅ **Harden conversation persistence against races** (Critical) — Completed
   - Implementation: Added atomic `Repository.mutate()` in file repos and new `LiveRepos.appendMessagesToConversation`/`finalizeThreadStatusAtomic`; switched `repoAppendMessage(s)`/`repoFinalizeThreadStatus` to use atomic helpers.
   - Key files: `src/backend/repository/core.ts`, `src/backend/repository/fileRepositories.ts`, `src/backend/liveRepos.ts`, `src/backend/services/conversation-mutations.ts`.
   - Exit Criteria: Concurrent appends serialize under lock; no message loss in `conversations.json`.

2. ✅ **Enforce Google OAuth token completeness during onboarding** (Critical) — Completed
   - Implementation: `handleGoogleAccountCallback` now requires both `access_token` and `refresh_token`; throws `ValidationError` otherwise.
   - Key file: `src/backend/auth/oidc/flows.ts`.
   - Exit Criteria: Missing refresh token → 400; no write to `accounts.json`.

3. ✅ **Propagate diagnostics append failures** (High) — Completed
   - Implementation: Made logging helpers async and awaited in orchestrator/agent paths; failures propagate and fail the request.
   - Key files: `src/backend/services/logging-handlers.ts`, `src/backend/services/conversation-orchestrator.ts`, `src/backend/services/orchestration-agent.ts`.
   - Exit Criteria: FS error during diagnostics append surfaces as request failure.

4. ✅ **Fail tool orchestration on invalid workspace add inputs** (High) — Completed
   - Implementation: `handleWorkspaceAddItem` now injects exactly one tool error message for invalid inputs (missing/unknown `agent_id`, missing director context, thread ensure failures) and logs a step error.
   - Key file: `src/backend/services/conversation-orchestrator.ts`.
   - Exit Criteria: Invalid call yields single tool error reply; orchestrator logs failure.

5. ✅ **Validate conversation pagination parameters** (Medium) — Completed
   - Implementation: Strict validation in `GET /api/conversations` for integer `limit` (1..1000) and non‑negative integer `offset`; invalid inputs return 400.
   - Key file: `src/backend/routes/conversations.ts`.
   - Exit Criteria: `limit=abc` → 400 with descriptive error.

6. ✅ **Enforce array semantics for workspace item tags** (Medium) — Completed
   - Implementation: Service-level validation rejects non-array `metadata.tags` on create/update; orchestrator no longer coerces non-array tags.
   - Key files: `src/backend/services/workspace-service.ts`, `src/backend/services/conversation-orchestrator.ts`.
   - Exit Criteria: Scalar `tags` rejected; store unchanged.

7. ✅ **Remove duplicate `list_agents` tool implementation** (Medium) — Completed
   - Implementation: Consolidated to a single `list_agents` case; optional `directorId` validated (unknown director → error), filtering applied when valid.
   - Key file: `src/backend/toolCalls.ts`.
   - Exit Criteria: One canonical `list_agents` implementation; validated filtering semantics.
