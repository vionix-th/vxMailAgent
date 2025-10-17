# Shared Types Guide

- **Scope:** Cross-package types and utilities under `src/shared` consumed by backend and frontend.
- **Authority:** Obey global policy in `AGENTS.md` and type rationale in `docs/DEVELOPER.md`.

## Type Contracts
- **Required By Default:** Define identifiers, enums, and discriminants as required fields; optional members need inline justification.
- **Discriminated Unions:** Encode tool payloads, results, and UI state with explicit `kind`/`type` fields so consumers exhaust cases.
- **Secrets Separation:** Keep secret-bearing types backend-only; export public DTOs that omit tokens/keys.
- **No Defaults For Invariants:** Avoid `||`/`??` fallbacks on required values; enforce validation at producers.
- **Single Source:** Update the shared type and fix all dependents in the same change; do not add shims or duplicate shapes.

## Tooling
- **Build Consumers:** Run backend/frontend builds after changing shared types to catch breakage (`npm run build` in each package).
- **Testing:** Coordinate with owning package maintainers before adding new shared-level tests; backend integration suites remain the verifier.

## References
- **Global Protocol:** `AGENTS.md`
- **Backend Usage:** `docs/DEVELOPER.md`
- **Design Context:** `docs/DESIGN.md`
