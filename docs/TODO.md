# Audit Remediation TODO

1. **Harden conversation persistence against races** (Critical)
   - Dependencies: Requires repository-level atomic append helpers in `LiveRepos` before refactoring orchestrator writers.
   - Actions: Design and implement append/update API with file locking; migrate `repoAppendMessage(s)` and conversation orchestrators to use it; regression test concurrent writes to confirm no message loss.
   - Exit Criteria: Parallel assistant replies against same thread persist all messages in `conversations.json` without loss.

2. **Enforce Google OAuth token completeness during onboarding** (Critical)
   - Dependencies: None; can run in parallel with task 1.
   - Actions: Validate access/refresh tokens in `handleGoogleAccountCallback`; throw validation error and prevent persistence when either token missing; add negative coverage via handler tests.
   - Exit Criteria: Callback lacking refresh token returns 4xx and `accounts.json` remains unchanged.

3. **Propagate diagnostics append failures** (High)
   - Dependencies: None, but align logging helpers with new repo append semantics from task 1 if implemented first.
   - Actions: Update logging helpers to await repository writes; bubble errors to orchestrator; verify failing append rejects request and surfaces actionable error.
   - Exit Criteria: Simulated FS error while logging results in surfaced failure, no silent loss.

4. **Fail tool orchestration on invalid workspace add inputs** (High)
   - Dependencies: Requires conversation append fix (task 1) to avoid new races when injecting error messages.
   - Actions: Replace early returns in `handleWorkspaceAddItem` with tool-error injection and propagate failure flag; ensure orchestrator emits single error tool message per invalid call.
   - Exit Criteria: Tool call without `agent_id` produces error tool response and orchestrator reports failure.

5. **Validate conversation pagination parameters** (Medium)
   - Dependencies: None.
   - Actions: Introduce schema validation for `limit`/`offset`; enforce numeric bounds and fail fast on invalid inputs.
   - Exit Criteria: Request with `limit=abc` returns HTTP 400 with descriptive message.

6. **Enforce array semantics for workspace item tags** (Medium)
   - Dependencies: Coordinate with task 4 so tool payloads align with validation outcome.
   - Actions: Validate `metadata.tags` as array-only, default only when undefined; reject malformed inputs and plan cleanup for existing bad records.
   - Exit Criteria: Posting workspace item with scalar tags is rejected and data store remains unchanged.

7. **Remove duplicate `list_agents` tool implementation** (Medium)
   - Dependencies: After tasks affecting tool orchestration (4 & 6) to minimize merge conflicts.
   - Actions: Consolidate logic into single `list_agents` branch supporting necessary filters; confirm tool registry behavior via unit tests.
   - Exit Criteria: Only one `list_agents` case remains and tests cover both director-filtered and global listings.