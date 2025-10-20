# Backend Execution Guide

- **Scope:** Backend routes, services, repositories, and harness utilities under `src/backend`.
- **Authority:** Follow global policy in `AGENTS.md` and architecture details in `docs/DEVELOPER.md` + `docs/DESIGN.md`.

## Run & Build
- **Package location:** The repo root has no `package.json`; set your working directory to `src/backend` or use `npm --prefix src/backend ...` for every command.
- **Install (from anywhere):** `npm --prefix src/backend install`
- **Dev Server:** `npm --prefix src/backend run dev`
- **Build:** `npm --prefix src/backend run build`
- **Start Built Artifact:** `npm --prefix src/backend run start`
- **Quality Gate:** run `npm --prefix src/backend run lint`, `npm --prefix src/backend run typecheck`, then `npm --prefix src/backend run build`

## Runtime Invariants
- **Fail Fast:** Validate env vars, ids, and payload contracts at route/service boundaries; missing inputs must throw descriptive errors.
- **No Defaults:** Never mask required identifiers via `||` or `??`; rely on explicit validation helpers and raise.
- **Secrets:** Keep tokens/keys server-only; public DTOs must remove secret-bearing fields before returning responses.
- **Repositories:** Mutations go through repository interfaces; maintain single source of truth per entity.
- **Forward Only:** Modify existing producers instead of adding shims or compensating layers.
- **No Migrations:** Schema changes edit the current structures in place; never add migration scripts or legacy compatibility code unless Caesar gives explicit written approval for that task.

## Harness & Testing
- **Build First:** `npm --prefix src/backend run build` so compiled modules exist under `dist/backend`.
- **Run Integration Suites:** `cd src/backend && node --test --test-reporter=spec tests/integration/*.cjs`
- **Harness Wrapper:** Use `withServer(async ({ baseUrl }) => { ... })` plus `createSession()` and `createLogCapture()` from `tests/lib`; ensure cleanup in `finally`.
- **Charters:** See `src/backend/tests/AGENTS.md` for destructive-test rules and appendices for pipeline/integration specifics.

## References
- **Global Protocol:** `AGENTS.md`
- **Type Contracts & APIs:** `docs/DEVELOPER.md`
- **Architecture Context:** `docs/DESIGN.md`
