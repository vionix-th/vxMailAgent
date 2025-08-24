# vxMailAgent Developer Guide

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
