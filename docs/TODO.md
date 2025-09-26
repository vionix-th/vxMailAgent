1. [x] Define granular conversation persistence APIs on `ConversationsRepository`/`LiveRepos` (insert, append, finalize, delete-by-id) so callers stop replaying whole snapshots.
2. [x] Refactor orchestrator and tool flows to use the new APIs instead of `setConversations`/`replaceConversations` (depends on #1).
3. [x] Remove the legacy snapshot helpers (`setConversations`, `replaceConversations`) and verify no backend path reloads entire conversation lists (depends on #2).
4. [x] Add `accountsRepo.updateTokens(accountId, tokens)` and update AccountManager + routes to call it, eliminating table rewrites.
5. [x] Split `createToolHandler` into injected per-tool services that rely on the granular conversation APIs, keeping tool execution stateless (depends on #2).
6. [ ] Validate UI/backoffice flows react cleanly when producer writes now reject stale snapshots, documenting any UX adjustments.
