# Code Quality Audit — Prompt

Perform a strict, producer‑first backend code audit. Do not implement changes; produce a detailed, actionable report only.

## Objective
- Identify flaws/bugs in architecture/design and business logic.
- Detect divergence from clean code and SOLID principles.
- Surface deprecated/legacy/unused code.
- Find opportunities to consolidate/unify code paths.

## Non‑Goals
- No code edits, migrations, or test writing.
- No shims/adapters to mask defects.

## Core Rules (enforceable)
- Root‑Cause‑First: Fix producers, not consumers; remove compensating logic (recommendations must target producers only).
- Single Source of Truth (SOT): Name the authoritative store per route/feature; verify consumers do not synthesize or backfill primaries.
- Fail Closed: On invalid inputs/config, error explicitly; no silent defaults.
- Validation & Defaults: Validate at boundaries; no defaults for invariants; use `??` only for typed optionals; never use `||` to default identifiers/dates.
- Types & Contracts: Strict typing; required identifiers (no optional IDs); prefer required arrays; discriminated unions for actions; keep secrets out of shared/public types.
- Diagnostics Separation: Domain models must not embed tracing/diagnostic fields; diagnostics reference domain by id.
- Error Handling: No swallowed errors or log‑and‑continue on invariants.
- Persistence Semantics: Reads/writes hit the authoritative store; append‑only logs use atomic append (no read‑modify‑set); enforce path containment under per‑user roots.
- Production Stability: Single canonical implementation per feature; remove deprecated/duplicate code.
- SOLID: SRP (one reason to change per module/service), OCP (extend via registries/config, avoid engine edits), LSP (preserve required fields/behaviors in implementations), ISP (narrow interfaces; avoid “god” services), DIP (depend on abstractions; inject repos/providers; avoid direct FS/network in domain logic).

## Procedure
1) Map SOTs: For each route/feature, name the SOT and check consumers for compensation/synthesis.
2) Scan invariants: Required fields present; no placeholders/coercion (empty strings, fabricated timestamps); dates parseable.
3) Parsing safety: Guard all `JSON.parse`; never fabricate absent fields; propagate structured errors.
4) Tools exposure: Mandatory tools exposed by default; optional via explicit allowlists; stubs fail with `not_implemented`.
5) External calls: Explicit timeouts for providers/tools; errors surfaced; no silent retries.
6) Security: No secret logging; validate required env/OAuth at startup and fail fast.
7) Dead/legacy code: Locate unused types/modules/routes, deprecated flags, duplicate implementations.
8) Unification: Identify overlapping code paths that can be consolidated without adding layers.

## Evidence‑Driven Sweep (suggested quick searches)
- Placeholders/defaults on invariants: `rg -n "\|\|\s*''|\|\|\s*'unknown'" src`
- Unsafe parse: `rg -n "JSON\.parse\(" src`
- Optional IDs / required arrays: `rg -n "\bid\??:\s*string|\?:\s*\w+\[]" src/shared src/backend`
- Deprecated/legacy: `rg -n "TODO|FIXME|@deprecated|legacy|XXX" src`
- Tool gating drift: `rg -n "enabledToolCalls|TOOL_REGISTRY|TOOL_DESCRIPTORS" src`
- Append semantics: `rg -n "append\(|setAll\(|getAll\(" src/backend`

## Report Format (output only)
- Executive Summary: 5–8 bullets with the most impactful issues and estimated risk.
- Findings (grouped): Architecture/Design, Business Logic, Best Practices & SOLID, Deprecated/Unused, Consolidation.
  - For each finding:
    - Title: concise issue name + severity (Critical/High/Medium/Low).
    - Evidence: files/lines, brief code excerpt (≤2 lines), or search pattern.
    - Defect Hypothesis: broken invariant and origin (producer component).
    - SOT Declaration: authoritative store/stream for the behavior.
    - Recommended Repair (producer‑only): minimal, surgical change (described; no patches).
    - Exit Criteria: concrete observable state after the fix (no guards).
    - Side effects/Risks: short note.
- Consolidation Proposals: short ranked list with trade‑offs and migration impact.
- Follow‑ups (optional): strictly ranked, low‑noise items.

## Interaction
- Ask only blocking questions if essential to proceed.
- Do not output diffs or run changes; generate the report only.

