# Backend Tests

## Naming Conventions
- `*.live.cjs`: live tests hitting a running backend (auth required).
- `*.unit.cjs`: fast unit/compile/instantiation checks.
- `*.mock.cjs`: mocked flows; do not claim to validate business logic.

## Running
- Live first, then unit/mock: `node run-all-tests.cjs`
- Only live: `node --test backend.live.cjs`

## Live Auth
- Env: `BACKEND_URL` (default `http://localhost:3001`), `JWT_SECRET` (default `dev-insecure-jwt`), `VX_TEST_USER_ID` (default `test-user`).
- The live test signs a JWT and sends `Authorization: Bearer …` to assume the user.

## Status + Agent Output
- Long steps emit `STATUS <label>: running <ms>ms` heartbeats.
- All steps also log `TEST_EVENT { ... }` and end with `RESULT_JSON { ... }` for machine parsing.

