# Test Harness (Backend)

Lightweight, modular utilities to boot the compiled backend (`dist/backend/**`),
open authenticated sessions, issue HTTP requests with timeouts, capture logs,
and manage deterministic test environments.

The harness keeps a stable public API across suites while separating concerns
into focused modules. Prefer the `withServer()` wrapper for new tests.

## Module Map

- `harness/index.js` — Public API. Tests should `require('../lib/harness')` (directory index).
- `harness/server.js` — `startBackend()`, `withServer()`; temp data dir + env toggles; graceful stop.
- `harness/session.js` — `discoverTestUser()`, `createSession()`.
- `harness/http.js` — `requestWithTimeout()`, `fetchJson()`.
- `harness/wait.js` — `waitFor()` polling helper.
- `harness/logs.js` — `createLogCapture()` via logger observers.
- `harness/env.js` — `applyTestEnv()` apply/restore env helper.
- `harness/paths.js` — `backendRoot`, `distRoot`, `dataUsersRoot`, `requireBackend()`.

## Public API (stable)

```
const {
  // lifecycle
  startBackend,           // -> { baseUrl, stop, fetcherManager }
  withServer,             // (ctx) => finally stop() (helper; optional for future refactors)

  // http
  fetchJson,              // (baseUrl, path, init?, { timeoutMs }?) -> { ok, status, data }
  requestWithTimeout,     // (baseUrl, path, init?, timeoutMs?) -> Response

  // session & user
  discoverTestUser,       // -> { uid, fsPath }
  createSession,          // (baseUrl, uid, info?) -> { token, cookie, headers }

  // wait & logs
  waitFor,                // async polling until predicate returns truthy
  createLogCapture,       // log buffer with .waitFor/.drain/.stop
  assertMetaFields,       // assert required fields exist in a captured log entry
} = require('../lib/harness');
```

## Environment Switches (test‑only)

Applied by `startBackend()` and restored automatically after `stop()`:

- `VX_MAILAGENT_DATA_DIR` — Per‑test temp copy of the user data directory.
- `VX_TEST_MOCK_PROVIDER=true` — Use the mock mail provider (no network/OAuth).
- `VX_TEST_DISABLE_ORCHESTRATOR=true` — Skip starting the async director loop
  during email processing; useful when validating HTTP/persistence surfaces.
- `VX_TEST_OPENAI_STUB=true` — Short‑circuit OpenAI chat completions to return
  a deterministic “stubbed-response” for prompt‑assist endpoints.
  - When workspace tools are exposed, the stub may emit a `workspace_add_item`
    tool call using `agent_id = process.env.VX_TEST_WORKSPACE_AGENT_ID || 'int-workspace-agent'`.

These switches gate external boundaries only; they do not alter core invariants
or repository contracts. Production is unaffected.

## Usage Patterns

Minimal pattern (explicit stop):

```js
const { startBackend, discoverTestUser, createSession, fetchJson } = require('../lib/harness');

test('example', async () => {
  const { baseUrl, stop } = await startBackend();
  try {
    const { uid } = discoverTestUser();
    const { headers } = await createSession(baseUrl, uid);
    const res = await fetchJson(baseUrl, '/api/health', { headers });
    assert.strictEqual(res.ok, true);
  } finally {
    await stop();
  }
});
```

Recommended wrapper:

```js
const { withServer } = require('../lib/harness');

await withServer(async ({ baseUrl }) => {
  const log = createLogCapture();
  try {
    // ... run calls
  } finally {
    log.stop();
  }
});
```

## Requirements & Notes

- Build the backend before running tests: `cd src/backend && npm run build`.
- Tests call only the HTTP surface against the compiled server; no repo stubs.
- Every test must ensure cleanup (delete created entities; call `stop()`), or
  use `withServer()` once suites are refactored to it.
- The harness discovers the test user via a `.testuser` marker under
  `data/users/<uid>`, matching production formats (e.g., `google:{sub}`).

## Migration Notes

- The legacy shim `tests/lib/harness.js` was removed; require the directory index
  via `require('../lib/harness')`.

## Rationale

- Clear separation of concerns reduces cognitive load and change risk.
- Deterministic toggles make suites repeatable without introducing production
  defaults or fake secrets.
- Log capture enables asserting observability without DB spelunking.
