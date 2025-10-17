# Backend Execution Guide

- **Scope:** Backend routes, services, repositories, and harness utilities under `src/backend`.
- **Authority:** Follow global policy in `AGENTS.md` and architecture details in `docs/DEVELOPER.md` + `docs/DESIGN.md`.

## Run & Build
- **Dev Server:** `cd src/backend && npm install && npm run dev`
- **Build:** `cd src/backend && npm run build`
- **Start Built Artifact:** `cd src/backend && npm run start`
- **Quality Gate:** `cd src/backend && npm run lint && npm run typecheck && npm run build`

## Runtime Invariants
- **Fail Fast:** Validate env vars, ids, and payload contracts at route/service boundaries; missing inputs must throw descriptive errors.
- **No Defaults:** Never mask required identifiers via `||` or `??`; rely on explicit validation helpers and raise.
- **Secrets:** Keep tokens/keys server-only; public DTOs must remove secret-bearing fields before returning responses.
- **Repositories:** Mutations go through repository interfaces; maintain single source of truth per entity.
- **Forward Only:** Modify existing producers instead of adding shims or compensating layers.

## Harness & Testing
- **Build First:** Integration and pipeline suites require `npm run build` so compiled modules exist under `dist/backend`.
- **Run Integration Suites:** `cd src && node --test --test-reporter=spec backend/tests/integration/*.cjs`
- **Harness Wrapper:** Use `withServer(async ({ baseUrl }) => { ... })` plus `createSession()` and `createLogCapture()` from `tests/lib`; ensure cleanup in `finally`.
- **Charters:** See `src/backend/tests/AGENTS.md` for destructive-test rules and appendices for pipeline/integration specifics.

## References
- **Global Protocol:** `AGENTS.md`
- **Type Contracts & APIs:** `docs/DEVELOPER.md`
- **Architecture Context:** `docs/DESIGN.md`
