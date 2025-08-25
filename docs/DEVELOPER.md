# vxMailAgent Developer Guide

## Dev Servers and Ports

- Frontend: Vite on `http://localhost:3000` with proxy for `/api` → backend. See `src/frontend/vite.config.ts`.
- Backend: Express on `http://localhost:3001`. Entry: `src/backend/index.ts` → `createServer()` in `src/backend/server.ts`. Health: `GET /api/health`.

## Persistence & Encryption

- Storage lives under `data/` (overridable via `VX_MAILAGENT_DATA_DIR`).
- AES‑256‑GCM at rest when `VX_MAILAGENT_KEY` is a valid 64‑char hex.
- If missing/invalid, the backend still starts in PLAINTEXT mode and logs a warning. See `src/backend/config.ts::warnIfInsecure()` and `src/backend/persistence.ts`.
- Tracing/provider events retention settings are in `src/backend/config.ts` (e.g., `TRACE_MAX_TRACES`, `PROVIDER_TTL_DAYS`).

## Workspace Semantics (Current)

- Routes are namespaced by `:id`, but items are stored in a shared repository irrespective of `:id` (partitioning can be added later). See `src/backend/routes/workspaces.ts`.
- Endpoints implemented:
  - `GET /api/workspaces/:id/items` (supports `?includeDeleted=true`)
  - `POST /api/workspaces/:id/items`
  - `GET /api/workspaces/:id/items/:itemId`
  - `PUT /api/workspaces/:id/items/:itemId` (expects `expectedRevision` for conflict detection)
  - `DELETE /api/workspaces/:id/items/:itemId[?hard=true]`

## Backend API Overview (routes/)

- Health
  - `GET /api/health` — `src/backend/routes/health.ts`
- Prompts
  - `GET /api/prompts`, `POST /api/prompts`, `PUT /api/prompts/:id`, `DELETE /api/prompts/:id` — `src/backend/routes/prompts.ts`
  - `POST /api/prompts/assist` — Prompt Optimizer with app context packs. Requires `prompt.messages[]` and `target` in `{director|agent}`.
- Prompt Templates
  - `GET /api/prompt-templates`, `POST /api/prompt-templates`, `PUT /api/prompt-templates/:id`, `DELETE /api/prompt-templates/:id` — `src/backend/routes/templates.ts`
- Fetcher (email retrieval controller and logs)
  - `GET /api/fetcher/status` — loop active/running timestamps
  - `POST /api/fetcher/start`, `POST /api/fetcher/stop` — toggles and persists `fetcherAutoStart`
  - `POST /api/fetcher/trigger` (fire‑and‑forget), `POST /api/fetcher/run` (awaits)
  - `GET /api/fetcher/logs`, `DELETE /api/fetcher/logs/:id`, `DELETE /api/fetcher/logs` — via cleanup service
- Diagnostics
  - Unified/provider events and traces under `src/backend/routes/{diagnostics.ts, unified-diagnostics.ts}` (admin/debug). Keep separate from user Results.
- Accounts/Directors/Agents/Filters/Templates/Memory/Conversations
  - Modular files exist under `src/backend/routes/`. See each file for exact shapes.

## Prompt Assistant: Optional Context Inclusion

Endpoint: POST /api/prompts/assist

- Purpose: Optimize an existing prompt using the Prompt Optimizer template and optional application context packs.
- Required:
  - prompt — the prompt object (with messages[])
  - target — explicit target kind: one of ["director", "agent"]
- Optional:
  - including — controls additional context packs appended to the optimizer context. Does not change any saved prompts.

including accepted forms:
- "optional" → includes [examples, policies]
- "all" → includes all known packs [affordances, docs-lite, types-lite, routes-lite, examples, policies]
- string or array of explicit pack names, e.g. "examples,policies" or ["examples","policies"]

Notes:
- Base pack selection comes from the existing `context` parameter (defaults remain unchanged).
- `including` is merged with `context`; duplicates are de-duplicated.
- The optimizer message always excludes the full Affordances body from the application-context block to avoid duplication; affordances are included separately.
- No persisted prompts are modified by this endpoint.

Request example (body):
```json
{
  "prompt": { "id": "agent_translator", "name": "Translator", "messages": [ { "role": "system", "content": "..." } ] },
  "target": "agent",
  "including": "optional"
}
```

Request example (query):
```
POST /api/prompts/assist?including=all&target=director
```

Response shape:
```json
{
  "improved": { "id": "...", "name": "...", "messages": [ {"role":"system","content":"..."}, ... ] },
  "notes": "assistant-side notes"
}
```

## Context Packs (reference)
- affordances: role affordances and tool capabilities (authoritative)
- docs-lite: excerpts from DESIGN.md, Example.md, docs/DEVELOPER.md, docs/TROUBLESHOOTING.md
- types-lite: selected exports from src/shared/types.ts
- routes-lite: detected backend routes under src/backend/routes/
- examples: files from data/prompt-examples/
- policies: concise prompt-crafting policies

## Tracing & Provider Events (Admin)

- Tracing config in `src/backend/config.ts`:
  - `TRACE_VERBOSE`, `TRACE_PERSIST`, `TRACE_MAX_PAYLOAD`, `TRACE_MAX_SPANS`, `TRACE_MAX_TRACES`, `TRACE_TTL_DAYS`, `TRACE_REDACT_FIELDS`
- Provider events retention:
  - `PROVIDER_MAX_EVENTS`, `PROVIDER_TTL_DAYS`
- Diagnostics endpoints surface traces/provider events for admin only; they are not rendered in the user Results view.
