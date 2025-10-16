# Testing Agent Charter

Read this before touching any test. Violations revert to zero-trust immediately.

## 1. Source of Truth
- **Production parity only.** Exercise the compiled backend (`dist/backend/**`) through its HTTP surface and real repositories. No alternate harnesses, no stub repos, no short-circuiting services.
- **Session bootstrap via public API.** Obtain auth by calling the test-only `/api/test/session` route (requires `ENABLE_TEST_ROUTES=true`). Use the returned cookie + bearer token for every request; never forge tokens locally.
- **No synthetic environment seeding.** Tests never invent `process.env` defaults, fake OAuth/OpenAI credentials, or placeholder JWT secrets. Required keys must be supplied externally (CI, developer shell). If any are missing, abort with a clear error.
- **Real identities.** User IDs must match formats the backend accepts (e.g., `google:{sub}`). Do not create imaginary `test-user` IDs or bypass validation. If a user is required, provision it in the data directory just like production.

## 2. Forbidden Patterns (reject immediately)
- Setting or mutating env vars inside tests to paper over missing configuration.
- Monkey patching `conversationEngine`, providers, repositories, or service methods (including the previous `openai` mock delegate).
- Triggering fetcher/orchestrator loops repeatedly to fish for outcomes. Each test may drive at most one controlled run and must stop the loop explicitly.
- Leaving background timers, sqlite handles, or servers running between tests. Every test must shut down the Express server and call `shutdownRepos()` before exiting.
- Swallowing failures with timeouts. Any wait must have a hard upper bound ≤ 10s and emit actionable context when it expires. Use the shared harness timeout wrapper.
- Hard-coding user IDs, tokens, or data paths. Discover the permitted test user via the `.testuser` markers under `data/users/**` and use that exact UID. Fail loudly if none exist.
- Creating fake provider credentials, JWT payloads, or sqlite fixtures. If production requires them, the test runner must provide them beforehand.

## 3. Required Coverage
1. **Pipeline E2E** – Authenticate with a real JWT, verify the pre-seeded director/agent/filter/API config for the `.testuser` profile, trigger exactly one fetch cycle, and assert director + agent completion using the live provider path.
2. **Invariant Guards** – Explicit tests that prove the suite refuses to run when critical env/config is missing or malformed.
3. **Observability** – Once the pipeline is stable, verify provider events and orchestration logs reflect each conversation step without altering production code.

## 4. Execution Discipline
- Treat every test as destructive: rely on pre-seeded data wherever possible, and when creating fixtures (e.g., negative tests) clean them up via the public API before exiting.
- `docs/TODO.md` is the authoritative roadmap; update it as milestones complete and reference the exact tests that satisfy each line item.
- If the backend rejects a request (4xx/5xx), stop and diagnose. Never loop or retry blindly.
- When you need a mock behavior, escalate to Caesar. Do not add private toggles or helper libraries to “make tests pass.”
- Always stop fetcher loops (`/api/fetcher/stop`) and call `shutdownRepos()` through the harness before finishing the test.

## 5. Checklist Before Shipping Tests
- [x] No test mutates `process.env` with fallback values.
- [x] No monkey patches or module overrides are present.
- [x] Each server start has a matching `shutdownRepos()` and `server.close()` in `finally`.
- [x] Maximum wait duration per assertion ≤ 10 seconds with informative error messages.
- [x] All assertions rely on real lifecycle artifacts (HTTP responses, persisted repos, logs) without manual fabrication.
- [x] The active user ID is derived from a `.testuser` marker and validated against backend expectations.
- [x] Tests obtain a session via `/api/test/session` and reuse the returned cookie + bearer token for all calls.

Break any rule above and you reintroduce the exact rot we just removed. Keep it strict.
