# vxMailAgent Testing Roadmap

## Core Objectives
- [x] Ship a single authoritative end-to-end test that exercises the real email pipeline (discover test user, reuse pre-seeded configuration, trigger fetcher once, verify director + agent completion).
- [x] Prove the suite fails fast when required session/auth prerequisites are missing by using bounded request timeouts and explicit precondition checks.
- [x] Assert observability guarantees (provider events, orchestration steps) without resorting to mocks or instrumentation patches.

## Work Breakdown
### 1. Environment Harness (foundation)
- [x] Discover canonical test user via `.testuser` markers; abort when none found.
- [x] Assert required env keys without mutating `process.env`.
- [x] Provide shared bootstrap to start/stop compiled backend and repos per test.

### 2. Pipeline Flow Test (happy path)
- [x] Verify required pipeline entities (API config, director, agent, filters, account) already exist for the `.testuser` profile; fail with a clear diagnostic if any are missing.
- [x] Trigger exactly one fetch cycle; bound polling to ≤10s and stop background work after assertions.
- [x] Validate director + agent threads, final statuses, and assistant responses using persisted data without mutating pre-existing configuration.

### 3. Guard Rails (failure surfaces)
- [x] Explicit test that refuses to run when any required env variable is absent (expect actionable error).
- [x] Misconfigured director/filter scenario that yields a single fetch attempt and surfaces the precise repository error without retry loops.

### 4. Observability (post happy-path)
- [x] Verify provider events contain request/response entries tied to the pipeline run.
- [x] Confirm orchestration log captures each director+agent step with final status persisted.

## Tracking Notes
- Update this checklist as work completes; do not mark items until the test suite passes on a clean checkout.
- Cross-link implementation details inside `tests/AGENTS.md` so constraints remain visible to every contributor.
