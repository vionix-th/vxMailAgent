# Agents Guide (AGENTS.md)

Authoritative guide for how vxMailAgent’s LLM agents behave, interact, and are added or modified. This document defines roles, response protocol, coding discipline, and operational boundaries. It complements docs in `docs/DEVELOPER.md` and `docs/DESIGN.md`.

## 1) Roles & Responsibilities

- Director: Orchestrates conversations, calls tools, and delegates to Agents. One Director thread per email/conversation. See `src/shared/types.ts:DirectorThread`.
- Agent: Performs delegated sub-tasks, can call a subset of tools. Agent threads are children of a Director thread. See `src/shared/types.ts:Agent` and `src/shared/types.ts:AgentThread`.

Operational semantics for loops, tool-calls, and transcripts are specified in docs/DEVELOPER.md (Orchestrator Contract) and enforced by the backend services.

## 2) Interaction Protocol (LLM Response Rules)

- Identity: Refer to the user only as “Caesar” or “The Caesar.”
- Assumptions: Assume expert-level proficiency unless evidence contradicts it.
- Continuity: Maintain context; reference prior turns when needed for clarity.
- Style: Be precise, candid, and professional; avoid apologetic or motivational tone.
- Brevity: Default to concise answers; no filler or generic framing.
- Error Attribution: Point out Caesar’s mistakes only when essential for accuracy.
- Feasibility: If a request is impossible or outside capabilities, explicitly reject, explain why, and propose the nearest feasible alternative with trade‑offs. Never fabricate.

Progress and structure conventions:
- Preambles: Before running tools, briefly state the immediate next action (1–2 sentences).
- Plans: Use the `update_plan` tool for multi‑step or ambiguous tasks; keep steps minimal and logically ordered with one step in progress.
- Updates: For long tasks, provide short progress updates as milestones complete.
- Final Answers: Use clear headers and bullets where it improves scanability; keep formatting minimal and consistent. See “Response Structure” below.

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

Documentation
- Read `/docs/DEVELOPER.md` and `/docs/DESIGN.md` before architectural changes.

Error handling
- Add proper error handling and reporting; never silently swallow errors.
- Validate all external inputs early and fail fast with descriptive errors.

Defaults & validation
- No Defaults For Invariants: Missing/invalid required inputs/config cause startup/runtime errors with actionable messages.
- Allowlisted Defaults Only: Defaults must be spec‑approved, neutral, documented inline, covered by tests, and emit a one‑time WARN with key+value.
- Fail Closed: Prefer explicit errors over silent fallbacks; escalate to callers.
- Validate At Boundaries: Schema‑validate external inputs (env, request, tool params); reject on failure.
- Safe Defaulting Semantics: Use `??` only for typed optionals; never use `||` for defaulting.
- Layered Behavior: Backend enforces invariants strictly; UI may degrade while surfacing causes.
- PR Checklist: For each default, document safety, location, and tests for missing‑value and normal paths; log and count default activations.

Tooling enforcement
- TypeScript/ESLint: Enable `@typescript-eslint/strict-boolean-expressions`, `no-unnecessary-condition`, `no-implicit-coercion`; ban `||` defaulting; prefer `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- Backend lint config: `src/backend/eslint.config.cjs`; run via `npm run lint` in `src/backend/`.

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
- Prefer API changes that improve design; update UI to match backend changes.
- Use Git history for recovery; do not preserve obsolete implementations.

Explicit exclusions
- Do not add route aliases or deprecated endpoints.
- Do not implement type‑system workarounds; fix the underlying issue.
- Do not add unit tests unless explicitly instructed (project policy).

## 5) Tools, Approvals, and Sandbox

- Tools: Use `update_plan`, `apply_patch` (shell), repository read commands (`rg`, `sed`, `cat`), and other allowed tools as needed.
- Approvals: Some actions (writes, network access, destructive operations) may require approval depending on sandbox mode. Request escalation only when necessary and explain why.
- Sandbox: Prefer fast, read‑only commands (`rg`) for search. Read files in ≤250 line chunks.
- Safety: Avoid destructive actions unless explicitly requested by Caesar; suggest safer alternatives when possible.

## 6) Adding or Updating Agents

Data model (authoritative types): see `src/shared/types.ts` — `Agent`, `DirectorThread`, `AgentThread`.

Storage
- Per‑user repositories live under `data/users/{uid}/` (see `src/backend/utils/paths.ts`).
- Agents file: `agents.json`; prompts: `prompts.json`; directors: `directors.json`.

Required Agent fields
- `id` (string): Stable identifier.
- `name` (string): Display name.
- `type` (enum): Project‑specific agent kind.
- `promptId` (string): References a prompt in `prompts.json`.
- `apiConfigId` (string): API/model configuration to use.
- `enabledToolCalls?` (string[]): Optional allowlist of tool names.

Operational behavior
- Director exposes dynamic tools `agent__<id>` for assigned agents.
- Agent loops run with tools limited to `enabledToolCalls`.
- Transcripts must follow OpenAI ordering: assistant(with `tool_calls[]`) → tool → assistant → …

Change procedure
1) Define or update the Agent entry in the per‑user `agents.json`.
2) Create/update the referenced prompt in `prompts.json` (or Templates as appropriate).
3) If adding tools, ensure descriptors exist in `src/shared/tools.ts`, are gated by role, and parameters are schema‑validated at handlers.
4) Run backend lint/type‑check; verify orchestrator behavior matches docs/DEVELOPER.md acceptance checks.

## 7) Error Handling & Validation (LLM‑side)

- Validate inputs at boundaries and surface precise errors; never mask or silently default.
- If constraints are unmet, fail closed and provide actionable guidance.
- When proposing code changes, include paths and minimal diffs; do not over‑modify unrelated areas.

## 8) Appendix — Key Paths

- Types: `src/shared/types.ts`
- Tools catalog: `src/shared/tools.ts`
- Orchestrator: `src/backend/services/conversation-orchestrator.ts`
- Workspace service: `src/backend/services/workspace-service.ts`
- Repos registry: `src/backend/repository/registry.ts`
- Per‑user paths: `src/backend/utils/paths.ts`
- Backend ESLint config: `src/backend/eslint.config.cjs`
