# Implementation Plan — Manual Fetch Failure Remediation

## 1. Diagnose OpenAI Error Shapes
- [x] Capture timeout vs. generic failure responses via test stub flags; pending capture for 5xx/429 in staging.
- [x] Document the `Error.name`, `Error.message`, and available metadata in `docs/AUDIT.md`.
- [x] Decide canonical timeout code (`openai_request_timeout_<ms>`); other provider errors remain verbatim until real samples collected.

## 2. Harden OpenAI Wrapper
- [x] Update `src/backend/providers/openai.ts` to normalize aborts into `openai_request_timeout_<ms>` and classify other provider errors.
- [x] Unit-test mapping logic (guard with `VX_TEST_OPENAI_STUB`).
- [x] Ensure orchestration logs and fetcher logs receive the normalized error code.

## 3. Fix Orchestrator Timeout Handling
- [x] Clear `engineTimeoutId` in `conversation-orchestrator.ts` on rejection so duplicate "Engine timeout" logs stop.
- [x] Ensure failure path sets `fetcherAccountStatus.lastError` and trace status to `error`.
- [x] Write regression test inducing timeout to assert status/log alignment.

## 4. Enhance Fetcher Log Persistence
- [x] Extend SQLite schema (`fetcher_logs`) to store `message`, `runId`, `directorId`, `threadId`.
- [x] Update repository + DTO to persist/read new fields and keep `detail` JSON.
- [x] Adjust `FetcherControl` UI to render new columns and show timeout codes.

## 5. Improve Conversation Visibility
- [x] Update `/api/conversations` response and UI renderers to surface tool call summaries (e.g., function name, arguments snippet).
- [x] Add indicator when `content` is null but `tool_calls` exists; expand preview to include structured payload.
- [x] Ensure Conversation Inspector pulls persisted tool results without extra dialogs.

## 6. Expand Test Coverage
- [x] Add integration test that forces an OpenAI timeout and asserts failure surfaces via logs, fetcher status, and conversations.
- [x] Add pipeline test variant that forces OpenAI timeout and asserts failure surfaced via logs, status, and conversations.
- [x] Add integration test verifying tool call + tool result messages persist and are exposed by conversations API.
- [x] Add audit/assertions tying fetcher status/traces to orchestration outcomes.

## 7. Review UI/API Contract
- [x] Confirm Fields returned by `/api/conversations` and `/api/conversations/:id/details` meet updated UI needs.
- [x] Document data contract in `docs/DEVELOPER.md` to keep surfaces aligned.

---
Track progress in this file; cross-link updates back to `docs/AUDIT.md` once each bucket is complete.
