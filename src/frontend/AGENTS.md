# Frontend Execution Guide

- **Scope:** React + Vite UI under `src/frontend/src` plus build tooling in `src/frontend`.
- **Authority:** Follow global interaction policy in `AGENTS.md`; backend contracts live in `docs/DEVELOPER.md`.

## Run & Build
- **Install:** `cd src/frontend && npm install`
- **Dev Server:** `cd src/frontend && npm run dev`
- **Build:** `cd src/frontend && npm run build`
- **Preview:** `cd src/frontend && npm run preview`

## UI Discipline
- **Strict Types:** Enforce TypeScript strict mode; no implicit `any` or optional identifiers without justification.
- **Data Contracts:** Consume only public DTOs; never handle or log secrets delivered from the backend.
- **State Handling:** Model async state with discriminated unions; avoid silent defaulting of required props.
- **Error Surfacing:** Surface backend errors verbatim in UI with actionable messaging; do not swallow or reinterpret root causes.
- **Forward Only:** Remove or refactor existing components instead of layering temporary adapters.

## References
- **Global Protocol:** `AGENTS.md`
- **Backend/Shared Types:** `docs/DEVELOPER.md`
- **Design Intent:** `docs/DESIGN.md`
