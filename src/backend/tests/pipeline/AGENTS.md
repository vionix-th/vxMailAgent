# Pipeline Test Charter

Read `../AGENTS.md` and `tests/AGENTS.md` first. This appendix governs pipeline suites only.

## Required Coverage
1. **Pipeline E2E** – Authenticate with a real JWT, verify the pre-seeded director/agent/filter/API config for the `.testuser` profile, trigger exactly one fetch cycle, and assert director + agent completion using the live provider path.
2. **Invariant Guards** – Prove the suite refuses to run when critical env/config is missing or malformed.
3. **Observability** – Verify provider events and orchestration logs reflect each conversation step without altering production code.

## Additional Discipline
- Treat fetcher invocations as hazardous: drive at most one manual `/api/fetcher/run` per test and always pair it with `/api/fetcher/stop` in `finally`.
- Assert every orchestration artifact (threads, logs, provider events) is real. Never synthesize or backfill conversations to satisfy expectations.
- When tests create transient directors, agents, or filters, remove them via public routes before shutdown.
- Pipeline-specific waits must remain under 10s and surface precise debugging context (director id, filter id, fetcher status) on failure.
