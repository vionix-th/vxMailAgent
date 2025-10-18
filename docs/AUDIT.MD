# Audit Log — 2025-10-18 Manual Fetch Failure

## Summary
- **Event:** Manual fetch cycle for `.testuser` UID `google:105778401035214143955` on 2025-10-18 at 12:52:47Z.
- **Outcome:** Director thread `33717e74-cf4e-4523-abb5-4fe5cb1dd321` failed; fetcher surfaced `orchestration_error` with detail "Request was aborted." (OpenAI timeout at ~30 s).

## Evidence
- `fetcher_logs`
  - `3727842a-…` `fetch_cycle_start` 12:52:47Z.
  - `a9392b9f-…` `messages_listed` (gmail) count 1 12:52:48Z.
  - `cf357f68-…` `director_thread_created` 12:52:48Z.
  - `661d9838-…` `fetch_cycle_complete` 12:52:48Z (async orchestration still running).
  - `c0cb3661-…` `orchestration_error` 12:53:24Z detail "Request was aborted.".
- `orchestration_logs`
  - `67378ca2-…` step complete at 12:52:54Z (tool call issued).
  - `ad05946e-…` error at 12:53:24Z (`durationMs=30015`, `isTimeout=false`).
  - `682d4502-…` follow-up engine timeout 12:53:39Z (triggered after promise rejection).
- `traces`
  - Account trace `a474a42b-…` closed `status=ok` "Account processing completed" at 12:52:48Z.
  - Email trace `761ea249-…` closed `status=ok` "Email processed successfully" despite later failure.
- Conversation state
  - Thread `33717e74-cf4e-4523-abb5-4fe5cb1dd321` stored with `status='failed'`, `errors_json=[]`.
  - Messages show tool call `list_agents` with no subsequent tool response persisted.

## Identified Gaps
1. **Fetcher log persistence** lacks `message`, `runId`, `directorId`, and `threadId`; UI receives only `detail` string, leaving key context missing.
2. **Timeout classification**: OpenAI wrapper rethrows abort as generic "Request was aborted." so fetcher logs flag `isTimeout=false`.
3. **Timer cleanup**: `engineTimeoutId` not cleared on rejection, causing duplicate "Engine timeout" entry.
4. **Trace/account status**: account/email traces and `fetcherAccountStatus` report success before orchestration finishes, masking async failures.

## Next Steps (Investigation)
- Confirm OpenAI client behavior around abort vs. network failures.
- Inspect UI rendering for fetcher log `message`/metadata handling once persistence fixed.
- Determine safe point to await orchestration or propagate failure back to trace/status without blocking fetcher loop.
5. **Conversation UI visibility**: Conversations tab collapses tool call/response pairs into opaque “complex content,” making it hard to confirm protocol compliance; Investigations must open the inspector and decode the tool payload manually.

## Test Coverage Assessment
- **Pipeline E2E (email-pipeline.test.cjs):** Only asserts the happy path. It does not verify tool call transcripts, nor does it fail when orchestration stalls (e.g., OpenAI timeout yields a failed director thread). Needs negative-path coverage that confirms failed threads surface clear diagnostics and stop the test.
- **Fetcher/Observability integration:** Exercises CRUD endpoints but ignores semantics (no assertions on `detail`, `directorId`, `threadId`, or run correlation). Would not flag the missing `message`/metadata issue we observed.
- **Orchestrator logging integration:** Covers missing API config, but relies on manual API deletions; does not exercise fetcher-driven multi-step flows or LLM tool-call sequencing. There is no test ensuring list/tool replies round-trip or that tool payloads remain visible.
- **Gap:** No automated check that traces and `fetcherAccountStatus` stay in sync with asynchronous orchestration errors. A regression here would pass the current suites.

**Needed additions**
1. Pipeline test variant that induces an OpenAI timeout (env override or stub) and asserts: failed director thread, fetcher log captures timeout code, and UI-visible metadata exists.
2. Integration coverage ensuring tool calls produce both assistant tool call messages and tool results persisted; fail if UI API returns “complex content” without the underlying payload.
3. Assertions tying fetcher status and traces to orchestration outcomes so async failures flip both from `completed` to `failed`.

## Additional Investigation — OpenAI Failure Taxonomy
- Timeout generated through the stub (`VX_TEST_FORCE_OPENAI_ERROR=timeout`) yields a thrown error `{ name: 'OpenAIRequestTimeoutError', message: 'openai_request_timeout_30000ms' }`, with the original AbortError attached as `cause`.
- Generic provider failures forced via `VX_TEST_FORCE_OPENAI_ERROR=error` surface as `{ name: 'Error', message: 'Forced OpenAI error' }` and are rethrown without translation.
- Normal stubbed completions return the tool-call payload (no error) and preserve usage metrics.
- Outstanding capture: real 5xx/429 payloads from OpenAI production SDK (requires staging credentials) remain undocumented; keep TODO open until we sample those responses.

## Additional Investigation — Conversation Surfaces
- Conversations tab pulls `/api/conversations` and renders `PromptMessage.content` via Markdown. Messages with `content=null` (tool calls/responses) collapse to empty strings, so protocol steps become invisible unless the inspector is opened.
- Conversation Inspector overview flags such messages as "Complex content" but still stops at five-message preview; the actual tool payload requires drilling into the thread detail dialog.
- Both views share the same backend data; gaps stem from UI presentation. Any audit-driven fix must ensure list view exposes tool calls (at least labels or JSON preview) so failed runs reveal missing tool interactions without opening multiple dialogs.

## Remediation Progress — 2025-10-18
- OpenAI aborts now normalize to `openai_request_timeout_<ms>` and propagate into fetcher logs, orchestration logs, and fetcher account status.
- Asynchronous orchestration failures update traces and per-account status immediately; duplicate engine timeout entries cleared.
- Fetcher logs persist `message`, `runId`, `directorId`, and `threadId` and surface in the UI, enabling direct correlation from dashboard to database.
- Conversations tab and inspector render tool call metadata instead of opaque "complex content," exposing function call flow during triage.
- Unit test coverage locks down the OpenAI timeout normalization contract (`tests/unit/openai-provider.test.cjs`).
- Integration coverage (`tests/integration/orchestrator-timeout.test.cjs`) confirms fetcher logs, per-account status, and conversations all reflect orchestrator timeouts when the LLM call aborts.
- Pipeline coverage (`tests/pipeline/email-pipeline-timeout.test.cjs`) performs the same timeout scenario through the E2E harness to ensure operational dashboards expose the failure without manual log spelunking.
- Tool-call persistence coverage (`tests/integration/conversation-tool-persistence.test.cjs`) validates that `/api/conversations/:id` preserves assistant `tool_calls` and the matching tool replies so the UI always has the raw payloads.
- Test-only env flag `VX_TEST_FORCE_OPENAI_ERROR` documented (values: `timeout`, `error`) to drive specific provider failures inside the stub without hitting the network.
