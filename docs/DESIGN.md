# Design Specification

## 1. Overview
The application is a single, web-based system running on localhost for processing customer support emails, designed for a single user (e.g., a quality assurance manager) in a corporate environment. It uses a Node.js backend with TypeScript and a React frontend (bundled with Vite). In development, the frontend runs via Vite (http://localhost:3000) with a proxy to the backend (http://localhost:3001); Express serves the API only. The system supports multiple Gmail/Outlook accounts via OAuth 2.0, with a fetcher applying regex filters on From, To, CC, BCC, Subject, Body, Date to route emails to a variable number of director agents. The director’s LLM (model) controls orchestration via function-calling: it may invoke tools (calendar, to-do, filesystem, memory) and delegate to specialized agents via function calls. Agents are not invoked independently; the director sequences all actions. Results (plain text, markdown, rich text, images) are displayed in a React UI with text inline, images in an attachment panel with previews, customizable notifications, and direct reply sending with provider or user-defined signatures. Configurations are persisted in encrypted JSON, editable at runtime. The design is detailed, descriptive, and clear, minimizing ambiguity for LLM implementation while leaving code-level details to the implementer.

### Current Implementation Snapshot

- Dev servers: frontend runs on Vite (`http://localhost:3000`) and proxies `/api` to the backend (`http://localhost:3001`). See `src/frontend/vite.config.ts` and `src/backend/index.ts`/`server.ts`. The backend does not serve the frontend in dev.
- Encryption behavior: if `VX_MAILAGENT_KEY` is missing/invalid (not 64-char hex), the backend still starts and persists plaintext JSON with a startup warning. See `src/backend/config.ts::warnIfInsecure()` and `src/backend/persistence.ts`.
- Authentication/session: Stateless login via Google OIDC; backend issues an HttpOnly JWT cookie `vx.session` (SameSite=Lax; `Secure` in production). `requireAuth` guards routes except the public allowlist: `/api/auth/*`, `/api/auth/whoami`, `/api/health`. In production, HTTP is redirected to HTTPS and HSTS is set (`Strict-Transport-Security: max-age=31536000; includeSubDomains`).
  - Split OAuth clients: Separate Google OAuth client for app login (OIDC, minimal scopes) vs provider Gmail accounts (email access). Env vars: `GOOGLE_LOGIN_*` for login, `GOOGLE_*` for provider.
- Workspace store: `workspaces/:id` routes exist, but items are stored in a shared repository (`workspaceRepo`) irrespective of `:id` (partitioning can be added later). See `src/backend/routes/workspaces.ts`.
- Implemented routes include health, prompts, prompt-templates, conversations, accounts, directors, agents, filters, memory, settings, fetcher, diagnostics, and workspaces. Some live tools (calendar/todo/filesystem/memory) described below are planned and may not be wired as HTTP APIs yet.

Core Concept: For each routed email, a director AI orchestrates specialized agents via tool-calls and inter-agent messaging. All agents work in a shared Workspace for that email, where they add, list and remove items. The director decides next actions and completes the run; the Workspace is the deliverable.

## 2. Functional Requirements
- **Multi-Account Support**: Users add multiple Gmail/Outlook accounts, with emails fetched and processed in parallel.
- **Email Fetcher**: Retrieves emails via Gmail API/Microsoft Graph API, applies regex filters, routes to matching director(s), supports one email to multiple directors. Runs in the background only while the app is active (Node.js process running, UI open).
- **Director Agents**: Variable number (5-20), use any account’s emails, route through specialized agents based on a prompt and optional conversation imprint, access local memories if specified.
- **Specialized Agents**: Perform tasks (e.g., mood analysis, reply generation) with prompts/imprints, inherit director’s API configuration unless overridden. Support tool calls:
  - Calendar: Read/write all available calendars (Gmail/Outlook).
  - To-Do: Add tasks to provider-supported to-do lists (e.g., Microsoft To Do).
  - File System: Search/retrieve files by name/content within a user-defined virtual root.
  - Memory: Search/add/edit semi-structured memories (global: cross-agent, shared: director-agent pair, local: agent-specific); cascading search (local→shared→global), target-specific additions.
- **API Configuration**: Users manage multiple OpenAI API keys/models via UI, persisted securely. Each Director and each Agent is assigned an `apiConfigId` (string, required), referencing a specific API configuration. Model and temperature are defined solely in ApiConfig. Prompt does not define model or temperature. Temperature is deprecated.
- **Result Handling**: Displays original email and results (text inline, images in attachment panel with previews), with copy-to-clipboard. A future enhancement may add in-app sending once provider integrations are wired to routes.
- **Reply Sending**: Not currently exposed via an HTTP endpoint. A stub implementation exists in `src/backend/reply.ts`; future provider-integrated sending will use the signature managed at the account level. There is no global or per-agent/director signature.
- **Runtime Configuration**: Users add/edit/reorder directors, agents, API settings, filters, signatures, virtual root, memories (searchable table with scope switching).
- **Real-Life Workflow**: A manager filters client emails (e.g., `client*@domain.com` or “urgent”) to a director, which routes to a psychologist agent (mood analysis, memory update) and response agent (replies, to-do/file access). Reviews results, copies replies, manages memories.
- **Corporate Compliance**: Localhost, OAuth, encrypted JSON storage.
- **Simplification**: No PDF generation, simple filter UI, single Node.js application, OpenAI-only, no complex client-server protocols (e.g., IPC, WebSocket).

## 3. Technical Design
### 3.1 Architecture
- **Single Application**: A single Node.js application (TypeScript) with Express.js serves a React frontend (bundled via a tool like Vite or Webpack) and handles all logic: email fetching, filtering, orchestration, tool calls, and OpenAI API integration. Frontend communicates with backend via standard HTTP requests (e.g., `fetch` or `axios`), avoiding IPC or complex protocols (e.g., WebSocket, GraphQL).
- **Backend**: Node.js with Express.js for routing, email processing, tool calls, and persistence.
- **Frontend**: React with HTML/JavaScript/CSS, styled with Tailwind CSS for a professional look, using Material-UI (or similar) for components (modals, tables, buttons) to ensure developer/user-friendliness.
- **Persistence**: Encrypted JSON files store configurations, filters, signatures, virtual root, and memories.
- **Email Access**: Gmail API (`googleapis`) and Microsoft Graph API (`msal-node`) for email, calendar, and to-do access.
- **AI Integration**: OpenAI API (`openai` library) for director-led orchestration and agent tasks, using function-calling (tools, `tool_choice`).
- **OS Functions**: Node.js `fs` and `path` modules for file system access, restricted to virtual root.

### 3.2 Components
#### 3.2.0 Diagnostics vs Workspace Results (Separation)
* **Rationale**: Earlier iterations conflated orchestration diagnostics (process/audit trail) with deliverables. The system now strictly separates diagnostics from user-facing Results across API, types, persistence, and UI.
* **Canonical data model**:
  * Diagnostics: provider requests/responses/errors are modeled as `ProviderEvent`s (see 3.2.0b) and any orchestration traces required for audit. These are for admin/debugging only and are never rendered in the user Results UI.
  * Results (end-user): Results are synonymous with `WorkspaceItem`s. The Workspace (latest state when the director completes its run) constitutes the deliverables. No separate "orchestration result" type exists for the end-user UI.
* **API**:
  * Diagnostics (admin-only):
    - `GET /api/diagnostics/runtime` returns runtime status including encryption mode, data directory, and counts. See `src/backend/routes/diagnostics.ts`.
    - `GET /api/diagnostics/unified` returns a hierarchical diagnostics tree; `GET /api/diagnostics/unified/:nodeId` returns details for a specific node. See `src/backend/routes/unified-diagnostics.ts`.
  * Results (end-user):
    - Use Conversation/Workspace endpoints, e.g. `GET /api/conversations/byDirectorEmail?directorId=&emailId=` to locate the thread, then `GET /api/workspaces/:id/items` (and related) to list/preview artifacts.
    - There are no user-facing "orchestration results" endpoints; use Conversations/Workspaces exclusively.
* **Persistence**:
  * Transcripts are canonical and OpenAI-aligned (see 3.2.0b). Provider events are persisted separately. Workspace items are persisted via the Workspaces API using a shared repository (`workspaceRepo`); they are not embedded in the `ConversationThread`.
* **UI**:
  * Orchestration Diagnostics panel: Admin/debug only. May include structured debug artifacts such as function returns and provider payload summaries. Never re-renders the user Results view.
  * Results (Workspace) panel: Renders only `WorkspaceItem`s with MIME-aware previews. Never shows provider request payloads or orchestration internals.

#### 3.2.0b Canonical Transcript and Provider Events (OpenAI-aligned)

- **Canonical transcript (system of record)**
  - Conversations persist an OpenAI-compatible message array. Each message follows the provider schema (role: `system|user|assistant|tool`, `content`, optional `tool_calls`, `tool_call_id`, etc.).
  - Assistant tool calling is represented canonically: assistant message with `tool_calls[]`, followed by one `tool` message per `tool_call_id`.
  - This transcript is always sufficient to resume the conversation or reproduce the user-facing chat view.

- **Provider events (diagnostics/audit)**
  - Provider requests/responses/errors (e.g., OpenAI Chat Completions) are stored as separate, append-only events, not embedded in the transcript.
  - Event kinds: `request | response | error`, with timestamps, latency, usage, and redacted/raw payloads.
  - Surfaces in the Diagnostics UI only; the Results chat never mixes these with user-facing messages.

- **Workspace placement**
  - Workspace items (arbitrary MIME-typed content) are separate in concept from the transcript and provider events, and are persisted via the Workspaces repository exposed by `src/backend/routes/workspaces.ts` (not embedded in the `ConversationThread`). The Workspace is the deliverable.

- **Benefits**
  - Single source of truth for chat; deterministic UI; reduced coupling; easier multi-provider support.

#### 3.2.0a Workspace (Shared, Mutable, Conversation-centric)
- **Concept**: For each routed email/run, the director opens a shared `Workspace`. Director and agents can add, list, update, and remove items (arbitrary MIME-typed content). All participants have equal access. When done, the director completes its run; the Workspace is the deliverable. Status exists but is non-gating.
- **Shared Types** (`src/shared/types.ts`):
  - `WorkspaceItem` (MIME-first, provenance in `context`):
    - Shape:
      `{ id: string; label?: string; description?: string; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string; tags?: string[]; created: string; updated: string; revision?: number; deleted?: boolean; context: { email: { id: string; subject?: string; from?: string; date?: string }; director: { id: string; name?: string }; agent?: { id?: string; name?: string }; createdBy: 'director'|'agent'|'tool'; agentId?: string; tool?: string; conversationId?: string } }`.
    - MIME-first model: no `type` enum; rendering is driven by `mimeType` and `encoding`. Unknown MIME types fall back to raw views.
    - Encoding and data: `data` holds the payload when present. If `encoding === 'base64'`, `data` is base64-encoded. If `encoding === 'utf8'` or omitted, `data` is UTF-8 text. There is no `filename`, `sizeBytes`, or `url`.
    - Titles/display: derive labels from `mimeType` and/or `tags` rather than filenames.
  - `WorkspaceItemInput` supports optional `context` snapshot and a `provenance` override that the backend collapses into `context` on write.
  - Note: While `ConversationThread` has an optional `workspaceItems?: WorkspaceItem[]`, the persisted source of truth is the Workspaces repository via `src/backend/routes/workspaces.ts`. Do not embed items in conversations; use the Workspaces API.
- **API Endpoints (Workspace)**:
  - `GET /api/workspaces/:id/items` — list items (supports filter/paging). Use `?includeDeleted=true` to include soft-deleted items.
  - `POST /api/workspaces/:id/items` — add item.
  - `GET /api/workspaces/:id/items/:itemId` — get one item.
  - `PUT /api/workspaces/:id/items/:itemId` — update with `expectedRevision`.
  - `DELETE /api/workspaces/:id/items/:itemId` — remove item; `?hard=true` for hard-delete (default soft).
- **OpenAI Tools (Workspace)**:
  - Common (director + agents): `workspace_add_item`, `workspace_list_items`, `workspace_get_item`, `workspace_update_item`, `workspace_remove_item(hardDelete?)`.
    - Access: All participants (director and agents) may add/list/update/remove any workspace item; `hardDelete` is available to all participants.
- **Semantics**:
  - No accept/reject; the workspace is the result. There is no fallback to the director’s last assistant message; user-facing results are strictly `WorkspaceItem`s.
- **Permissions**:
  - All participants (director and agents): add/list/read/update/remove any item; hard-delete is allowed.
- **UI Responsibilities**:
  - Workspace view: MIME-aware rendering (known MIME types get tailored previews; unknown types fall back to download or raw view), add/update/remove, filter by type/tag/author, show provenance/revision, supersedes chains.
  - Diagnostics: log item add/update/remove with timestamps; surface storage/encryption state.

#### 3.2.0c Orchestration Diagnostics Logging (Structured/Required)

- **Scope**: All orchestration diagnostics emitted by the backend via `logOrch(entry)` covering director lifecycle, agent lifecycle, and any tool invocation (director or agent).

- **Required fields (all entries)**
  - `timestamp` (ISO)
  - `director`, `directorName?`
  - `agent`, `agentName?` (empty string allowed if N/A)
  - `emailSummary`
  - `phase`: one of `director | agent | tool | result`
  - Grouping: `fetchCycleId`, `dirThreadId`, `agentThreadId` when applicable

- **Detail metadata**
  - Tool calls MUST include `detail.tool` (tool name) and `detail.request` (input args; redact secrets as needed).
  - Agent final output MUST include `detail.action: 'agent_output'`.
  - Director lifecycle SHOULD include `detail.action` (e.g., `director_start`, `director_complete`).

- **Result and error**
  - If a step returns data, `result` MUST reflect it. For agent-phase final output, default to the agent’s final content when no explicit result is set.
  - Error paths MUST set `error` and retain `detail` (including `detail.request`).

- **Coverage (no omissions)**
  - Workspace tools: `workspace_add_item`, `workspace_list_items`, `workspace_get_item`, `workspace_update_item`, `workspace_remove_item`.
  - Agent messaging tools: `agent__<slugOrId>`.
  - Live tools: `calendar_read`, `calendar_add`, `todo_add`, `filesystem_search`, `filesystem_retrieve`, `memory_search`, `memory_add`, `memory_edit` (handlers currently stubbed in `src/backend/toolCalls.ts`; not exposed as HTTP routes).
  - Discovery/meta tools SHOULD also be logged: `list_agents`, `list_tools`, `describe_tool`, `validate_tool_params`, `read_api_docs`.

- **Identifiability and ordering**
  - Entries MUST be attributable via grouping IDs. Diagnostics UIs MUST interleave director and agent entries by `timestamp` and nest agent subtrees by matching the director invocation event (`detail.tool === 'agent'` and session IDs).

- **Persistence and encryption**
  - Diagnostics are persisted via the persistence layer. If `VX_MAILAGENT_KEY` is a valid 64‑char hex key, logs are encrypted (AES‑256‑GCM); otherwise plaintext with a startup warning.

- **Non-goals**
  - Diagnostics MUST NOT render as user-facing results. They are admin/debug only and separate from `WorkspaceItem`s and provider events.

- **Enforcement**
  - Emitting a tool event without `detail.tool`, omitting required fields, or missing result/error where expected is a defect. New tool branches MUST add compliant `logOrch()` calls.

#### 3.2.1 Email Fetcher
- **Functionality**: Fetches emails from all configured accounts periodically (background loop controlled by API) or on-demand. Runs only while the application is active. Applies regex filters to route emails to directors, supporting multiple directors per email. Control endpoints: `/api/fetcher/status|start|stop|fetch|run` (see `src/backend/routes/fetcher.ts`).
- **Configuration**: Filter rules defined in UI, stored in JSON (e.g., `{ field: "From", regex: "client[0-9]+@domain\.com", directorId: "director1" }`).
- **Implementation**: Uses Gmail API (`gmail.users.messages.list/get`) or Microsoft Graph API (`me/messages`) with Node.js `RegExp` for filtering. Errors (e.g., invalid regex) trigger UI alerts (e.g., “Invalid regex pattern”) and log to console.

#### 3.2.2 Authentication Module
- **Functionality**: Manages OAuth 2.0 flows for Gmail/Outlook (email access; additional scopes like calendar/to-do are planned). Retrieves provider signature where supported or allows custom entry in UI.
- **Configuration**: Stores account details and signatures in JSON (e.g., `{ id: "jane@company.com", provider: "gmail", signature: "Best, Jane" }`).
- **Implementation**: Handles OAuth redirects, token storage (encrypted JSON), and signature retrieval. UI shows signature preview/edit field during account setup.

##### 3.2.2a Session Authentication (App Login)
- Separate from provider account OAuth, the app login uses Google OIDC with minimal scopes (`openid email profile`). A distinct Google OAuth client is used for login to avoid interference with Gmail refresh tokens.
- Backend endpoints (`src/backend/routes/auth-session.ts`):
  - `GET /api/auth/google/initiate` → returns authorization URL.
  - `GET /api/auth/google/callback` → exchanges code, upserts user, sets `vx.session` HttpOnly cookie.
  - `GET /api/auth/whoami` → returns `{ user }` or 401.
  - `POST /api/auth/logout` → clears the `vx.session` cookie and ends the session.
- Middleware `requireAuth` guards all non-public endpoints. Cookie flags: HttpOnly, SameSite=Lax; `Secure` in production.
- Provider OAuth endpoints under `/api/oauth2/*` (Google/Outlook) are protected by `requireAuth`. Linking provider accounts is an authenticated action.
- Production: trust proxy, redirect HTTP→HTTPS, set HSTS.

###### Re-authorization Flow for Gmail/Outlook Tokens

- For Gmail/Outlook provider accounts, token refresh or API probe failures that require user action return `{ ok: false, error: <category>, authorizeUrl }` from `src/backend/routes/accounts.ts`.
- Error categories include: `missing_refresh_token`, `invalid_grant`, `network`, `other`. The frontend surfaces a re-authenticate action using the provided URL.
- Structured JSON logs capture the error category and context; info-level events log when a re-auth URL is generated.
  - Related endpoints for probes: `GET /api/accounts/:id/gmail-test` and `GET /api/accounts/:id/outlook-test`.

#### 3.2.3 Director Orchestration
- **Functionality**: Receive filtered emails and initialize a conversation using the director’s prompt and `ApiConfig`. The director’s model is in control and uses function-calling to invoke tools (calendar, to-do, filesystem, memory) and to message specialized agents via per-agent tools. Agents are not invoked independently.
- **Configuration**: Stored in JSON (e.g., `{ id: "director1", name: "Client Manager", prompt: "...", imprint: "", apiConfigId: "config1", accountIds: ["jane@company.com"], memoryAccess: ["agent1"] }`).
- **Implementation**: The orchestration loop is director-driven. The director’s model issues tool calls and, when delegating, spawns agent conversation threads; agent outputs are returned to the director as tool results, and the director produces the final content.

#### 3.2.4 Specialized Agents
- **Functionality**: Execute tasks (e.g., mood analysis, reply generation) with prompts/imprints, inherit the director’s API configuration unless overridden.
  - Agents are invoked by the director via delegation and run as model-controlled conversations.
  - Agents may call tools during their turns: Calendar, To-Do, File System, and Memory.
  - Agent runs are multi-turn and tool-enabled; the director chooses when to continue/stop delegation.

#### 3.2.5 Prompt Editor (ChatML/Multi-Turn)
- **Functionality**: Enables construction of prompts as a sequence of messages, each with a role (`system`, `user`, `assistant`, `tool`) and content, following OpenAI ChatML/message-based format. Supports multi-turn context, example interactions, and role-based instructions to guide the AI’s behavior and maintain context.
- **UI/UX**: Editor UI resembles the OpenAI Playground "Chat" mode. Allows adding, editing, reordering, and deleting message blocks, each clearly labeled by role. Supports insertion of variables (e.g., `{{email}}`) and live preview of the resulting message array. Users can save/load prompt templates for reuse.
- **Technical Requirements**:
  - Prompt schema must support an array of `{role, content}` objects, not just a single string. Roles include: `system`, `user`, `assistant`, `tool`.
  - Backend must accept and persist the full message array, and use it when invoking the OpenAI API.
  - Frontend must provide CRUD for the message sequence and map directly to the backend schema.
  - Ensures full compatibility with OpenAI ChatML and future multi-turn conversational models.

  - **File System**: Search/retrieve files by name/content within virtual root (e.g., `/home/jane/client_docs`), using Node.js `fs` (e.g., `readdir`, `readFile`).
  - **Memory**: Search/add/edit semi-structured memories (e.g., `{ id: string, content: string, scope: "global" | "shared" | "local", timestamp: string }`); search cascades (local→shared→global), additions specify scope.
- **Output**: Text (plain, markdown, rich text) or images; tool outputs (e.g., file content, memory entries) included only if agent specifies (e.g., in reply text or as attachments).
- **Configuration**: Stored in JSON (e.g., `{ id: "agent1", directorId: "director1", name: "Psychologist", prompt: "...", tools: ["calendar_read", "memory_add"] }`).
- **Implementation**: Uses OpenAI’s function-calling API for tasks/tools. Tool outputs are processed by the agent’s prompt logic.

#### 3.2.5 Processing Pipeline
- **Functionality**: Fetcher queues emails, processed in parallel across accounts/directors. Directors pass emails/outputs to agents, collecting results. Tool calls validated (e.g., file access within virtual root) with transparent logging (e.g., `console.log("File access denied")`).
- **Implementation**: Uses Node.js async (e.g., `Promise.all`) for parallel processing, respects API rate limits (OpenAI, Gmail, Microsoft Graph).

#### 3.2.6 UI
 - **Layout**: Split-pane for the Results view. The original email panel is visually de-emphasized and collapsed by default (read-only, headers/body/attachments) and can be toggled from the Results header. The right pane shows results. In the current simplified browser UI, the right pane is a single preview-only view for the selected workspace item (no chat thread rendering). The Diagnostics view is a separate panel focused on the audit/process trail; it may display structured debug artifacts (function returns, provider payload summaries) but must not re-render the User Result View.
  - **Components**:
  - **Accounts**: Modal for OAuth, signature preview/edit (text area showing provider default or custom).
  - **API Settings**: Form to add/edit OpenAI keys/models.
  - **Directors/Agents**: Forms for prompts, imprints, tool selection; drag-and-drop for agent ordering.
  - **Filters**: Dropdown for fields, regex input, help link with examples (e.g., `from:client.*@domain\.com`, `Subject: urgent.*`).
  - **Memory**: Searchable table for global/shared/local entries, with edit/delete/scope-switching buttons.
  - **Settings**: Text field for virtual root (e.g., `/home/jane/client_docs`).
  - **Results (Workspace-centric)**:
    - Left navigation tree: emails → directors → workspace items.
      - Selecting an email: right pane shows the aggregated workspace view for that email (summary list/grid of its `WorkspaceItem`s).
      - Selecting a director: right pane may show the chat thread with that director under the selected email (when enabled). Tool-call messages are rendered with structured visualization (chips + formatted payloads); no empty bubbles.
      - Selecting a workspace item: right pane shows a MIME-aware preview (markdown/HTML for text, image previews, file chips, formatted JSON for structured content). Chat is hidden in this mode.
    - The original email panel is collapsed by default; it can be toggled to show snippet/body/attachments.
    - Toolbar: Refresh, Delete active, Delete selected/all; per-row delete with confirmation. Wired to existing backend endpoints. Diagnostics/admin controls remain separate.
    - Canonical component: `src/frontend/src/Results.tsx`.

  - **Diagnostics (Admin/Debug)**:
    - Two-pane layout with resizable splitter. Left: grouped/flat tree of cycles and threads. Right: detail tabs (see below).
    - Grouping and attribution are strictly canonical, using only: `fetchCycleId`, `dirThreadId`, `agentThreadId` (and `phase` for labeling). No heuristic fix-ups.
    - Director entries and agent subtrees are interleaved by timestamp to reflect the true event sequence. Agent subtree anchors use the director invocation event timestamp (`detail.tool === 'agent'` with `detail.sessionId` matching the `agentThreadId`); if absent, fallback to the first agent event timestamp.
    - Left pane: toggle between Grouped and Flat views; hierarchical accordions for director and agent nodes; click-to-activate sets the active event.
    - Right pane tabs (order is mandatory): [Result, Email].
      - Result: shows the structured result payload (if present) and Diagnostic detail as JSON for debugging. This does not re-render the user-facing Result View.
      - Email: shows headers, snippet, and attachments for the originating email, with a toggle to view raw JSON.
    - Delete controls: per-entry delete and bulk delete are available; operations use the Diagnostics endpoints.
  - **Workspace**: Conversation detail view renders the workspace item list (type, provenance, tags, preview, created/updated, revision) with controls to Add/Update/Remove. Wired to:
    - `GET /api/workspaces/:id/items`
    - `POST /api/workspaces/:id/items`
    - `PUT /api/workspaces/:id/items/:itemId`
    - `DELETE /api/workspaces/:id/items/:itemId[?hard=true]`
  - **Notifications**: Browser Notification API (e.g., “Processing complete for email ID:123”).
  - **Implementation**: React with Tailwind CSS for styling, Material-UI (or similar) for professional components, communicates with backend via HTTP (e.g., `fetch`).

#### 3.2.7 Persistence
- **Storage**: Encrypted JSON file stores:
  - Accounts (email, provider, signature).
  - API configs (key, model).
  - Directors (name, prompt, imprint, API config, accounts, memory access).
  - Agents (name, prompt, imprint, tools, API config).
  - Filters (field, regex, director).
  - Virtual root (path).
  - Memories (id, content, scope, timestamp, directorId, agentId).
- **Implementation**: Node.js `crypto` for encryption, runtime updates saved immediately.
  - **Encryption Key (VX_MAILAGENT_KEY)**:
    - 64-character hex value enables encryption at rest for all persisted JSON data files (accounts, configs, conversations, logs) and workspace storage (indexes, manifests).
    - Empty string or a missing/invalid key results in PLAINTEXT mode. The backend still starts and logs a startup warning (see `src/backend/config.ts::warnIfInsecure()`). This matches the dev-first behavior noted in "Current Implementation Snapshot".
    - State (encrypted vs plaintext) is logged with timestamp; all persistence operations include structured, timestamped logs.

- **Conversations and Provider Events**
  - Conversations are stored as `ConversationThread` objects containing canonical OpenAI-aligned `messages[]` and lifecycle (`status`, timestamps). They do not embed provider events or workspace items.
  - Provider requests/responses/errors are persisted as separate append-only `ProviderEvent` entries (e.g., JSONL or an events array per thread). These include timestamps, latency, token usage, and redacted payloads.
  - Diagnostics APIs read from Provider Events; chat UIs read strictly from `messages[]`.
  - Large payloads may be truncated with external references (e.g., file manifests) to control storage growth.

#### 3.2.8 Director-Driven Orchestration (Model-In-Control)
- **Overview**: The director’s LLM is authoritative. It initializes the conversation for each routed email and controls the flow via function-calling.
- **Tools (Director model)**: The director sees a curated tool surface:
  - Discovery: `list_agents` (assigned roster), `list_tools` (currently available tools, reflecting dynamic exclusions).
  - Agent messaging: per-agent tools exposed as `agent__<slugOrId>`.
  - Workspace tools: `workspace_add_item`, `workspace_list_items`, `workspace_get_item`, `workspace_update_item`, `workspace_remove_item`.
  - Live tools: `calendar_read`, `calendar_add`, `todo_add`, `filesystem_search`, `filesystem_retrieve`, `memory_search`, `memory_add`, `memory_edit`.
  - Tool names and schemas are defined in `src/shared/tools.ts`; live provider actions are handled via stub implementations in `src/backend/toolCalls.ts` (no separate HTTP routes yet).
  - **Conditional availability**: If a director has no assigned agents, there are no agent tools. Discovery tools still return an empty roster.
  - **Agent messaging (conversational, session-based)**: The director manages agent conversations by calling a per-agent tool with a message and optional `sessionId`.
  - If `sessionId` is absent, a new agent session (child `ConversationThread`) is created and returned.
  - Each call appends the director’s message to the agent session and runs the agent turn. The agent may call tools; the application resolves those tool calls and feeds results back to the agent until the agent emits an assistant message or a step-limit is reached.
  - The tool result returned to the director includes `{ sessionId, output, toolCalls[], done? }`. The director decides whether to continue messaging the agent, manipulate the workspace, or complete the run.
- **Session lifecycle**:
  - Agent session reuse: within a single director conversation, each agent has at most one active session. The director reuses the agent `sessionId` across multiple `agent__<id>` tool calls. Director conversations are never reused across emails/runs.
  - Timeout: sessions expire after a configurable inactivity period (e.g., 15 minutes) and reject further messages with a clear error. Timeout is logged.
  - Scope end (director completion): when a director conversation is completed or otherwise closed, all child agent sessions are marked `status: 'completed'` with `endedAt` set. These sessions are not `finalized` and further messages to those sessions are rejected.
  - Lifecycle fields (ConversationThread):
    - `status`: includes `ongoing` | `completed` | `failed` | `expired`.
    - `lastActiveAt`: ISO timestamp of the last message/activity in the thread.
    - `expiresAt`: ISO timestamp when the session becomes invalid due to inactivity.
  - Finalized flag semantics:
    - Only director threads set `finalized: true` on completion. Agent threads never set `finalized: true`; their terminal state is expressed via `status` and timestamps.
  - Settings:
    - `sessionTimeoutMinutes` (default 15) controls inactivity timeout. Exposed via Settings API/UI.
  - Rejections and logging:
    - Agent tool calls with an expired `sessionId` return a structured error (`reason: "expired"`).
    - Agent tool calls after director completion return a structured error (`reason: "completed"`).
    - All lifecycle events are timestamped and surfaced in diagnostics.
- **Traceability**: Each `ConversationThread` (director/agent) maintains a canonical OpenAI-aligned transcript in `messages[]`. Provider requests/responses/errors are appended as separate `ProviderEvent` entries (request/response/error) with timestamps, usage, and latency. Diagnostics endpoints expose these events; the user-facing chat derives solely from the canonical transcript.

#### 3.2.8b OpenAI Tools and Canonical Signatures

- **Discovery (Director)**
  - `list_agents()` → returns assigned agents: `[{ id, name, summary?, apiConfigId }]`.
  - `list_tools()` → returns currently available tools for the director context: `[{ name, description, paramsSummary }]`.

- **Agent Messaging (Director)**
  - Per-agent tools exposed as `agent__<slugOrId>` share the same signature:
    - Input: `{ input: string; sessionId?: string; options?: { allowTools?: boolean; toolFilter?: string[] } }` (`input` required).
    - Output: `{ sessionId: string; output: string; toolCalls: [{ name: string; args: any; success: boolean; error?: string }]; done?: boolean }`.

- **Workspace (Common and Director-only)**
  - Common (director + agents):
    - `workspace_add_item(label?, description?, mimeType?, encoding?, data?, tags?)` → `{ item }`
    - `workspace_list_items()` → `{ items[] }`
    - `workspace_get_item(id)` → `{ item }`
    - `workspace_update_item(id, patch, expectedRevision?)` → `{ item }`
    - `workspace_remove_item(id, hardDelete?)` → `{ removed: true }`
    - Access: All participants (director and agents) may add, list, update, and remove any workspace item. `hardDelete` is available to all participants.

- **Live Tools (Director and Agent)**
  - `calendar_read(provider, accountId, dateRange)` → returns events. Required: `provider`, `accountId`, `dateRange: { start, end }`.
  - `calendar_add(provider, accountId, event)` → adds event. Required: `provider`, `accountId`, `event: { title, start, end, ... }`.
  - `todo_add(provider, accountId, task)` → adds a to-do. Required: `provider`, `accountId`, `task: { title, ... }`.
  - `filesystem_search(virtualRoot, query)` → name-based search within virtual root. Required: `virtualRoot`, `query`. No default virtual root.
  - `filesystem_retrieve(virtualRoot, filePath)` → retrieve a file. Required: `virtualRoot`, `filePath`.
  - `memory_search(scope?, owner?, tag?, query?)`.
  - `memory_add(scope?, entry? | content?)`.
  - `memory_edit(entry { id, ... })`.
  - Notes: parameter schemas are enforced from `src/shared/tools.ts`; implementations are currently stubs in `src/backend/toolCalls.ts`.



### 3.3 Data Flow
1. User adds accounts, sets signatures/virtual root via UI/OAuth.
2. Fetcher retrieves emails in the background (while app is active), applies regex filters, routes to directors.
3. Directors process emails, pass to agents (e.g., psychologist, response agent).
4. Agents execute tasks, use tool calls (calendar, to-do, file system, memory); memory searches cascade, additions target specific scopes.
5. Results displayed (text inline, images with previews); tool outputs included if agent specifies.
6. Notification alerts user, who copies or sends reply with signature.
7. User manages memories via UI table.
