# Frontend Execution Guide

- **Scope:** React + Vite UI under `src/frontend/src` plus build tooling in `src/frontend`.
- **Authority:** Follow global interaction policy in `AGENTS.md`; backend contracts live in `docs/DEVELOPER.md`.

## Run & Build
- **Package location:** The repo root has no `package.json`; set your working directory to `src/frontend` or use `npm --prefix src/frontend ...` for every command.
- **Install (from anywhere):** `npm --prefix src/frontend install`
- **Dev Server:** `npm --prefix src/frontend run dev`
- **Build:** `npm --prefix src/frontend run build`
- **Preview:** `npm --prefix src/frontend run preview`

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
