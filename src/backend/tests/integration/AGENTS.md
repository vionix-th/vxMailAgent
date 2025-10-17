# Integration Test Charter

Read `../AGENTS.md` and `tests/AGENTS.md` first. This appendix defines integration-suite expectations.

## Scope
Integration tests validate HTTP contracts, CRUD invariants, and guard-rails without orchestrating the full pipeline. They run against the compiled backend through the shared harness.

## Required Coverage
1. **Session Bootstrap** – `/api/test/session` succeeds for the discovered `.testuser` and rejects missing/invalid UIDs.
2. **Settings & Accounts** – `/api/settings` exposes at least one API config, `/api/accounts` reports linked mailboxes, and both surface actionable errors when prerequisites are absent.
3. **Director/Agent CRUD** – CRUD endpoints enforce prompt/apiConfig requirements, sanitize optional tools, and clean up created records.
4. **Filter Guards** – Filter creation validates field enums, rejects invalid regex, and requires an existing director reference.
5. **Fetcher Controls** – `/api/fetcher/run|stop|status|logs` respond deterministically without kicking off long-lived loops.
6. **Observability Endpoints** – `/api/conversations/:id/details` returns 404 for missing threads, while `/api/conversations/:id/provider-events` returns canonical data (empty array when none exist).

## Discipline
- Keep fixtures minimal: create only what the test needs and delete via public APIs before shutdown.
- Record acceptance criteria in the test header comments if behavior depends on seeded data or secrets.
- Never skip tests silently; if prerequisites are missing, `test` must fail with a direct remediation message.
