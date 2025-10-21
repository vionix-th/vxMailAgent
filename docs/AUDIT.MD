Business Logic — Memory tool IDs collide and violate invariants (Critical)

Evidence: memory_add falls back to mem_${Date.now()} whenever the payload omits an id, so two tool calls in the same millisecond generate the same identifier while MemoryRepository.insert enforces uniqueness.
Defect Hypothesis: The memory tool (producer) invents unstable primary keys, causing inserts to start failing unpredictably once throughput increases or parallel calls land in the same millisecond. Downstream consumers never recover because the repository rejects duplicates.
SOT Declaration: memory_entries table via MemoryRepository.
Recommended Repair (producer-only): Require a proper id from the tool caller or generate it with the canonical newId() helper inside the memory handler before writing to the repository. Do not fall back to timestamp strings.
Exit Criteria: Re-run the memory tool twice in rapid succession and observe two distinct rows persisted with unique UUID v4 ids; repository no longer raises “already exists” for back-to-back inserts.
Side effects/Risks: Updating the identifier logic will require migrating any existing timestamp-based ids if they were already written.
Business Logic — Agent delegation errors leave transcripts inconsistent (High)

Evidence: After workspace_add_item returns success, executeAgentConversation catches any downstream failure, logs it, and exits without sending an error tool message back to the director thread or finalising the child conversation, so the transcript claims success while the agent never ran.
Defect Hypothesis: The orchestrator (producer) swallows orchestration failures when spawning agents, leaving the canonical conversation thread in an impossible state (tool call acknowledged, no agent result). Consumers can neither retry nor detect the failure.
SOT Declaration: conversation_threads and associated message history via ConversationsRepository.
Recommended Repair (producer-only): Propagate the exception: append a tool error message via injectAgentErrorMessage, finalise the agent thread to 'failed', and rethrow so the director loop can fail the step and mark the conversation accordingly.
Exit Criteria: Force an agent configuration failure (e.g., remove its API config) and observe that the director transcript now contains a tool error message and the thread status flips to failed.
Side effects/Risks: Tightening error propagation will surface currently silent misconfigurations; monitoring may momentarily spike.
Architecture/Design — Agent bootstrap scans the entire conversation table (Medium)

Evidence: Every workspace_add_item call loads all conversations into memory to locate/create the agent thread before appending messages.
Defect Hypothesis: The orchestrator (producer) performs O(n) scans on the conversation store per tool call, which will degrade latency once a user accumulates large histories, and risks stale snapshots in concurrent runs.
SOT Declaration: conversation_threads repository (SQLite).
Recommended Repair (producer-only): Replace the getConversations sweep with targeted repository methods (e.g., getConversationById plus a direct insert when missing) so only the relevant parent/child threads are fetched.
Exit Criteria: Profiling shows the agent bootstrap now issues at most two SQL statements regardless of thread count, and the orchestration step latency no longer scales with history size.
Side effects/Risks: Minor refactor of ensureAgentThread API may be required to accept repo access instead of a full snapshot.
Best Practices & SOLID — Email processor bypasses type contracts with any (Medium)

Evidence: The filter evaluation path returns Promise<any[]>, builds an EmailContext as any, and downcasts results with as any, bypassing the strict typing policy documented for the backend.
Defect Hypothesis: The email processor (producer) side-steps compile-time guarantees, allowing malformed filter results to slip through unnoticed and forcing downstream logic to rely on runtime checks.
SOT Declaration: Email filter evaluations sourced from the filters repository.
Recommended Repair (producer-only): Introduce explicit interfaces for the filter evaluation context/results and remove any casts, ensuring TypeScript enforces field presence before orchestration begins.
Exit Criteria: Type-checking fails if a filter evaluation omits mandatory fields (e.g., fieldValue), and the processor compiles without any in the happy path.
Side effects/Risks: The stricter types may uncover hidden bugs in test fixtures that relied on loose shapes.
Deprecated/Unused — Optional tool handlers are registered but unimplemented (Low)

Evidence: Calendar, filesystem, and todo executors are registered in the tool registry yet always return { success: false, error: 'not_implemented' }, while the shared registry still exposes them as optional capabilities that directors can enable.
Defect Hypothesis: The tool registry (producer) advertises integrations that inevitably fail, forcing every consumer to handle not_implemented responses instead of gating availability up-front.
SOT Declaration: Tool availability defined in shared/tools.ts.
Recommended Repair (producer-only): Either remove these tool specs until implementations exist or gate registration so unresolved tools never reach the runtime registry.
Exit Criteria: Optional tool toggles for calendar/filesystem/todo disappear (or remain disabled) in director/agent configs, and no tool call can produce the not_implemented stub response.
Side effects/Risks: UI expectations around optional tool toggles may need to be updated to reflect the temporary removal.
Consolidation Proposals

Centralise tool stub handling: Replace the three identical not_implemented executors with a shared utility (or remove them entirely) so the tool registry cannot drift away from runtime capabilities; this simplifies future enablement work.
Typed filter evaluation module: Extract the filter evaluation context/result typing into a shared helper used by both evaluateFilters and the processor, eliminating duplicated any logic and keeping field validation in one place.
Repository-driven agent thread helper: Refactor ensureAgentThread to accept repository access instead of full conversation snapshots, aligning both routing and orchestration on a single path for child thread discovery.