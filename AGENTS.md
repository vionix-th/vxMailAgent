# Agents Guide (AGENTS.md)

Authoritative guide for how vxMailAgent’s LLM agents behave, interact, and are added or modified. This document defines roles, response protocol, coding discipline, and operational boundaries. It complements docs in `docs/DEVELOPER.md` and `docs/DESIGN.md`.

## 0) Guardrails Against Assumptions

- Read the relevant package-level `AGENTS.md` (e.g., `src/backend/AGENTS.md`, `src/frontend/AGENTS.md`, `src/backend/tests/AGENTS.md`) before running any command or editing files.
- Execute only documented commands; if the instructions do not list a command, stop and ask Caesar instead of inventing or inferring one.
- When a documented command fails, report the failure verbatim and wait for direction—do not substitute a different command or workflow.
- Respect the workspace structure: never assume a package root or tooling location; locate the authoritative guide and follow it exactly.
- Treat every ambiguous requirement as a clarification request. Guesswork and “best effort” shortcuts are forbidden.

## 1) Interaction Protocol (LLM Response Rules)

- Identity: Refer to the user only as “Caesar” or “The Caesar.”
- Assumptions: Assume expert-level proficiency unless evidence contradicts it.
- Continuity: Maintain context; reference prior turns when needed for clarity.
- Style: Be precise, candid, and professional; avoid apologetic or motivational tone.
- Brevity: Default to concise answers; no filler or generic framing.
- Feasibility: If a request is impossible or outside capabilities, explicitly reject, explain why, and propose the nearest feasible alternative with trade‑offs. Never fabricate.

Progress and structure conventions:
- Preambles: Before running tools, briefly state the immediate next action (1–2 sentences).
- Plans: Use a todo list for multi‑step or ambiguous tasks; keep steps minimal and logically ordered with one step in progress.
- Updates: For long tasks, provide short progress updates as milestones complete.
- Final Answers: Use clear headers and bullets where it improves scanability; keep formatting minimal and consistent. See “Response Structure” below.

## 2) Package Execution Boundaries

- **No root package.json:** The repository root never contains a Node package. Run all npm scripts with `npm --prefix <package-path> …` (e.g., `npm --prefix src/backend run build`, `npm --prefix src/frontend run dev`).
- **Wrong-directory errors are on you:** If a command fails with “missing package.json,” stop and rerun it with the correct `--prefix`. Do not patch tooling or add wrappers to compensate.
- **Surface location in guidance:** When documenting build/test steps, always include the explicit package path so future agents repeat the correct command.

## 3) Response Structure

- Headers: Use only when they add clarity; keep them short.
- Bullets: Use “- ” with bolded keyword then colon (e.g., “- Bold: detail”).
- Monospace: Wrap commands, file paths, env vars, and code identifiers in backticks.
- File References: Use clickable paths with optional single line/column (e.g., `src/app.ts:42`). No ranges or URIs.
- Structure: Group related bullets; order general → specific. Avoid deep nesting.
- Tone: Factual, direct, present tense. No repetition or filler.
- Don’ts: No ANSI codes, no excessive headings, no mixed bold+monospace.

## 4) Coding Discipline

Focus & process
- Stay on the immediate task; avoid tangents.
- Use iterative, stepwise problem solving; maintain a short internal plan when helpful.

Clean code
- Follow S.O.L.I.D. principles and narrow responsibilities.
- Separate workspace management, logging, and agent coordination into dedicated services.
- Enforce strict typing and explicit identifiers; no optional IDs in core entities.

Root‑Cause‑First (RCF) Policy — mandatory
- Fix producers, not consumers: If output is missing/invalid, repair the component that produces it (ingestion, persistence, orchestration), not the caller.
- No backfill/synthesis in the backend: Do not fabricate or “derive” primary data from other stores to mask gaps.
- Minimal delta: Prefer editing existing code over adding new files or layers. Adding code to compensate for bugs is prohibited.
- Remove palliative code: If you find compensating logic, remove it while fixing the root cause.

Change Gate (must be satisfied before writing code)
- Defect hypothesis: State the specific broken invariant and where it originates.
- SOT declaration: Identify the single source of truth touched by the change.
- Repair location: Name the producer to change and why the route/UI must not compensate.
- Exit criteria: Define the observable state that proves the fix (without adding logs, guard scripts, or fallbacks).

Prohibited “shortcuts” (reject and escalate)
- Backend fallbacks (synthesizing missing primaries from other stores).
- Adding guard/monitor scripts instead of fixing the bug (unless Caesar explicitly asks for guards).
- Introducing new modules to route around a defect (“shim”, “hotfix layer”, “temporary adapter”).

Documentation
- docs/DESIGN.md: describes the target/final product and intended behavior.
- docs/DEVELOPER.md: documents current implementation, APIs, and active development.

Error handling
- Add proper error handling and reporting; never silently swallow errors.
- Validate all external inputs early and fail fast with descriptive errors.

Defaults & validation (authoritative)
- No Defaults For Invariants: Missing/invalid required inputs/config cause startup/runtime errors with actionable messages. Do not “fix” by inserting defaults.
- Allowlisted Defaults Only: Defaults must be spec‑approved, neutral, documented inline, covered by tests, and emit a one‑time WARN with key+value.
- Fail Closed: Prefer explicit errors over silent fallbacks; escalate to callers.
- Validate At Boundaries: Schema‑validate external inputs (env, request, tool params); reject on failure.
- Safe Defaulting Semantics: Use `??` only for truly optional, typed fields. Never use `||` for defaulting. Do not convert `||`→`??` while keeping the same default on invariants — defaulting itself is forbidden for invariants.
- Layered Behavior: Backend enforces invariants strictly; UI may degrade while surfacing causes.
- UI‑only degradation: Any degradation must live in the UI layer. Backend routes never degrade by inventing data.
- PR Checklist: For each default, document safety, location, and tests for missing‑value and normal paths; log and count default activations.

### Invariants & Defaulting — Do/Don’t (binding)

Forbidden patterns (reject and remove):
- `x || ''`, `x || "unknown"`, `x || []`, `x || {}` for required identifiers, secrets, tokens, IDs, dates, or file paths.
- `x ?? ''` (or any string/array/object) on invariants.
- `String(x || '')`, `String(x ?? '')` coercions for invariants.
- Defaulted destructuring on invariants, e.g. `const { token = '' } = tokenSet`.
- Silent sanitize that converts absence into presence (e.g., trimming/normalizing then using the value without re‑validation).

Allowed patterns:
- Boundary‑first validation with explicit errors. Example:
  - Do: `const t = tokenSet.access_token; if (typeof t !== 'string' || !t) throw new OAuthError('No access token', 'OAUTH_NO_ACCESS_TOKEN', 502);`
  - Don’t: `const t = String(tokenSet.access_token || '');`
- For typed optionals only (never invariants): `const q = typeof req.query.q === 'string' ? req.query.q : undefined; // ok`

LLM Checklist before writing code (must pass):
1) Identify invariants touched (tokens/secrets, IDs, dates, required params, file paths). If any can be missing → fail fast; do not default.
2) If introducing defaults, confirm they’re allowlisted, neutral, and spec‑approved; add a one‑time WARN and tests. Otherwise, remove the default.
3) Search for accidental defaults:
   - `rg -n "\|\|\s*''|\|\|\s*\"\"|\|\|\s*\[\]|\|\|\s*\{\}" src`
   - `rg -n "\?\?\s*['\"]|String\(.*\|\||String\(.*\?\?" src`
   - `rg -n ":\s*\w+\s*=\s*''" src`
4) If a default is present to satisfy TypeScript, remove it and strengthen runtime validation or types instead.

Examples (OAuth/secrets/IDs):
- Do: `const id = req.params.id; if (!id) throw new ValidationError('id required');`
- Don’t: `const id = req.params.id || '';`
- Do: `const key = process.env.JWT_SECRET; if (!key) throw new Error('JWT_SECRET required');`
- Don’t: `const key = process.env.JWT_SECRET || 'dev';`

Comments & sources
- Only add comments where they add value; do not comment self‑evident code.
- Consult authoritative documentation as needed; avoid speculation.

Conventions & quality
- Follow language idioms; call out non‑idiomatic patterns explicitly.
- Keep commits focused; run lint, type‑check, and tests before committing.
- Present original vs. corrected code with concise reasoning when refactoring.

Alternatives & optimizations
- Provide 2–3 ranked alternatives with trade‑offs when multiple valid solutions exist.
- Propose optimizations proactively with brief justifications; require Caesar’s confirmation before applying.

Production awareness & stability
- Consider error handling, security, scalability; do not gold‑plate.
- Complete one architectural change fully before starting another.
- Remove deprecated code immediately; maintain a single canonical implementation per feature.
- Test functionality after changes to ensure stability.

Forward‑only development
- No backwards compatibility or migrations unless explicitly instructed.
- Pre-release policy: do not add schema migration code; adjust the schema directly and document any one-off manual steps until the product has an external release.
- Prefer API changes that improve design; update UI to match backend changes.
- Use Git history for recovery; do not preserve obsolete implementations.

Forward Programming (No Re‑past)
- Do not paper over past mistakes with new code. If prior work is at fault, modify or remove it directly.
- If you can’t pinpoint a root cause within two short passes, stop and ask Caesar before adding any new file, script, or layer.

Explicit exclusions
- Do not add route aliases or deprecated endpoints.
- Do not implement type‑system workarounds; fix the underlying issue.
- Do not add unit tests unless explicitly instructed (project policy).
- Migration requests: If asked to add database migrations, legacy compatibility layers, or downgrade paths, refuse and escalate to Caesar. The backend must evolve in place without shims.

## 5) Tools, Approvals, and Sandbox

- Tools: Use `update_plan`, `apply_patch` (shell), repository read commands (`rg`, `sed`, `cat`), and other allowed tools as needed.
- Approvals: Some actions (writes, network access, destructive operations) may require approval depending on sandbox mode. Request escalation only when necessary and explain why.
- Sandbox: Prefer fast, read‑only commands (`rg`) for search. Read files in ≤250 line chunks.

Test harness usage (when modifying tests)
- Prefer `withServer(async ({ baseUrl }) => { ... })` over manual `startBackend/stop`.
- Keep per‑test cleanup and `logCapture.stop()` inside the wrapper’s `finally`.
- Do not add new harness layers or shims; extend `tests/lib/harness/*` minimally.

## 6) Error Handling & Validation (LLM‑side)

- Validate inputs at boundaries and surface precise errors; never mask or silently default.
- If constraints are unmet, fail closed and provide actionable guidance.
- When proposing code changes, include paths and minimal diffs; do not over‑modify unrelated areas.
