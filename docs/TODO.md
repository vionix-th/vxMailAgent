## Integration Test Expansion

### Completed
- [x] Settings & API config management (update session timeout, CRUD API configs, unauthorized guard)
- [x] Prompts, templates, and imprints lifecycle (CRUD + duplicate/conflict, reserved template protection)
- [x] Account lifecycle (validation, create/list redaction, signature update, refresh error handling)
- [x] Agent/director optional tool validation and filter maintenance (invalid tool guards, update failures, reorder)
- [x] Fetcher lifecycle controls (start/run/fetch/stop, log deletion)
- [x] Memory entries & cleanup routes (CRUD, bulk delete, fetcher logs cleanup)
- [x] Authentication guard regression pack (key endpoints return 401 without session)

### Pending
- [ ] Prompt assist coverage (requires provider-backed API config; ensure success + invalid payload failure)
- [ ] Conversation & workspace flows (list pagination, message append, workspace CRUD, assistant orchestration)
- [ ] Remaining cleanup/memory edge cases (workspace cross-refs, provider event pruning)
- [ ] CI follow-up (run full integration + pipeline suites post-expansion)
