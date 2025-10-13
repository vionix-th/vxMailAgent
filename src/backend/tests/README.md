# Backend Tests

## Naming Conventions
- `*.live.cjs`: live tests hitting a running backend (auth required).
- `*.unit.cjs`: fast unit/compile/instantiation checks.
- `*.mock.cjs`: mocked flows; do not claim to validate business logic.

## Running
- Live first, then unit/mock: `node run-all-tests.cjs`
- Only live: `node --test *.live.cjs`

### In-process Backend
- Live suites no longer assume a pre-running server. Each file calls `startTestServer()` (see `tests/lib/test-server.cjs`) to boot the backend on an ephemeral port and tears it down in an `after` hook.
- The helper applies test-safe env defaults (`tests/lib/env.cjs`), so no manual `.env` preparation is required.
- To exercise an external deployment instead, set `VX_TEST_IN_PROCESS_SERVER=false` and start the backend yourself; `run-all-tests.cjs` will re-enable preflight checks in that mode.
- Common fixture data (api configs, prompts, directors, accounts, filters) should be seeded via `tests/lib/fixtures.cjs` to avoid repeating REST priming logic.
- `run-all-tests.cjs` skips `*.live.cjs` suites unless `VX_TEST_INCLUDE_LIVE=true` is set; use that flag for REST smoke coverage when needed.
- Test servers clone `VX_MAILAGENT_DATA_DIR` into a per-run temp folder; set `VX_TEST_CLONE_DATA=false` when you explicitly want to mutate the real store.

-## Live Auth
- Env: `BACKEND_URL` (default `http://localhost:3001`), `JWT_SECRET` (default `dev-insecure-jwt`), `VX_TEST_USER_ID` (must be set explicitly or discovered via a `.testuser` marker under `data/users/<uid>/`).
- The live test signs a JWT and sends `Authorization: Bearer …` to assume the user.

## Status + Agent Output
- Long steps emit `STATUS <label>: running <ms>ms` heartbeats.
- All steps also log `TEST_EVENT { ... }` and end with `RESULT_JSON { ... }` for machine parsing.

## Live Coverage (prioritized)
- Health/auth/settings baseline.
- CRUD: settings (apiConfigs), directors, agents, filters (+reorder).
- Diagnostics runtime and conversations listing.
- OAuth: initiation URLs; refresh/test flows return reauthUrl for tokenless accounts.
- OpenAI (optional): `/api/test/chat` hits provider when `OPENAI_API_KEY` is set.
- E2E orchestration (mocked): with `VX_TEST_MOCK_PROVIDER=true` and `VX_TEST_MOCK_OPENAI=true`, `/api/fetcher/run` processes a mock email and creates a director conversation, optionally appending a mock assistant reply.

## Optional OpenAI Live Test
- Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.
- Run: `node --test openai.live.cjs`.

## Mocked End-to-End
- Backend env: set `VX_TEST_MOCK_PROVIDER=true` and `VX_TEST_MOCK_OPENAI=true` before starting the backend.
- Then run: `node --test e2e_orchestration.live.cjs`.
