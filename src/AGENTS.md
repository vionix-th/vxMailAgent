# Repository Guidelines

> Docs Scope: `docs/DESIGN.md` describes the target/final product and intended behavior; `docs/DEVELOPER.md` covers current implementation, APIs, and ongoing development.

## Project Structure & Module Organization
- Backend: `src/backend/` (Express, TypeScript). Routes in `routes/`, services in `services/`, utils in `utils/`, config in `config.ts`.
- Frontend: `src/frontend/` (React + Vite). App code in `src/frontend/src/`.
- Shared: `src/shared/` (cross‑cutting types and assets like `site-logo.png`).
- Tests: `src/backend/tests/` with live (`*.live.cjs`), unit (`*.unit.cjs`), mock (`*.mock.cjs`).

## Build, Test, and Development Commands
- Backend dev: `npm --prefix src/backend run dev` (starts Express via ts-node).
- Backend build: `npm --prefix src/backend run build` → `dist/`; start: `npm --prefix src/backend run start`.
- Backend quality: `npm --prefix src/backend run lint` • `typecheck` • `typecheck:strict` • `check`.
- Frontend dev: `npm --prefix src/frontend run dev` • build: `npm --prefix src/frontend run build` • preview: `npm --prefix src/frontend run preview`.
- Tests: `node src/backend/tests/run-all-tests.cjs`. Live-only: `node --test src/backend/tests/*.live.cjs`.

## Coding Style & Naming Conventions
- Language: TypeScript strict. Use `??` only for typed optionals; never default with `||`.
- Indentation: 2 spaces; files `kebab-case.ts`; types `PascalCase`; functions/vars `camelCase`; env `UPPER_SNAKE`.
- Lint: `src/backend/eslint.config.cjs` enforces error handling and bans direct thread mutations (use `services/conversation-mutations.ts`). Fix warnings before commit.

## Testing Guidelines
- Framework: Node’s test runner (`node --test`) with CJS helpers.
- Conventions: `*.live.cjs`, `*.unit.cjs`, `*.mock.cjs`. Prefer covering routes (CRUD, diagnostics, OAuth) and orchestration flows.
- Authentication: Most `/api/**` routes require auth (health/auth are public). Authenticate via:
  - OAuth (browser): start backend, open `/api/auth/google/initiate`, complete login; cookie `vx.session` is set and reused.
  - Test JWT: sign HS256 JWT with payload `{ uid: '<user-id>' }` using `JWT_SECRET` (default `dev-insecure-jwt`). Send `Authorization: Bearer <token>` or `Cookie: vx.session=<token>`.
    Example (generate and call a protected route):
    `(cd src/backend && TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({uid: process.env.VX_TEST_USER_ID || 'test-user'}, process.env.JWT_SECRET || 'dev-insecure-jwt'))")) && \\
     curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/agents`
- Live env: set `BACKEND_URL`, `JWT_SECRET`, `VX_TEST_USER_ID`; optional `OPENAI_API_KEY` for provider tests. Live tests auto-sign a JWT and pass it as Bearer.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `security:`). Keep scope focused.
- PRs: include purpose, linked issues, testing notes (commands + outcomes), screenshots for UI, and security considerations if touching auth/persistence.
- Gates: lint + typecheck + tests must pass. No silent defaults for required config; fail fast with clear errors.

## Security & Configuration
- Encryption key: export `VX_MAILAGENT_KEY` (64‑char hex) for at‑rest encryption.
- Do not log secrets. Validate external inputs at boundaries. Follow `docs/DESIGN.md` principles and root `AGENTS.md` coding discipline.
