# vxMailAgent — Design Specification

Note on scope: This document describes architecture and intended behaviors, and may include planned features. For the authoritative list of implemented HTTP APIs and developer procedures, see `docs/DEVELOPER.md`.

## 1. Overview

### System Architecture
vxMailAgent is a secure, multi-user web application for processing and managing emails through AI-powered workflows. The system is built with a modern tech stack:

- **Frontend**: React + Vite (http://localhost:3000 in development)
- **Backend**: Node.js + Express (http://localhost:3001 in development)
- **Authentication**: OAuth 2.0 with JWT sessions
- **Data Storage**: Encrypted JSON files with strict user isolation
- **AI Integration**: OpenAI API for natural language processing

### Terminology

- **Thread**: Canonical persisted chat object. In code this is `ConversationThread` with OpenAI‑aligned `messages[]` and lifecycle fields.
- **Conversation**: Informal synonym for Thread used in UI/docs.
- **Turn**: One user message followed by the assistant’s reply. A Director step may include tool execution and a subsequent assistant message.
- **Workspace Items**: MIME‑typed artifacts persisted via the Workspaces repository and keyed by the director thread id (`conversationId`). Not embedded in the thread transcript.

### Core Security Principles

1. **Zero Trust Architecture**
   - All operations require explicit authentication
   - No implicit trust of any request
   - Principle of least privilege enforced

2. **Data Isolation**
   - Strict per-user data separation
   - No cross-user data access
   - Containerized user environments (planned; not implemented in code)

3. **Defense in Depth**
   - Multiple layers of security controls
   - Input validation at all layers
   - Comprehensive audit logging

4. **Secure by Default**
   - Secure configurations out-of-the-box
   - No backdoors or debug endpoints in production
   - Automatic security updates

## 2. Data Model

### Core Entities

#### User
- `id`: Stable user id (e.g., `google:{sub}`)
- `email`: Primary email
- `name?`: Optional display name
- `picture?`: Optional avatar URL
- `createdAt`: Account creation timestamp (ISO)
- `lastLoginAt`: Last login timestamp (ISO)

#### Account (Email Provider)
- `id`: Unique identifier (UUID v4)
- `provider`: 'gmail' | 'outlook'
- `email`: Account email
- `signature`: Email signature
- `tokens`: `{ accessToken, refreshToken, expiry }`

#### Workspace Items (director-thread scoped)
- Persisted via the Workspaces repository, keyed by the director conversation thread id (`conversationId`).
- Shape matches `WorkspaceItem` in `src/shared/types.ts` (MIME-first, provenance context, optional `tags`, `revision`, soft-delete via `deleted`).
- Items are not embedded in `ConversationThread` objects; use Workspaces endpoints to read/write.

### Relationships
- User 1:N Account
- Each director conversation thread 1:N WorkspaceItem (via Workspaces repository, keyed by `conversationId`)

## 3. Security Architecture

### Authentication & Session Management

#### Session Security
- **JWT-based Authentication**
  - HttpOnly, Secure, SameSite=Lax cookies
  - Short-lived access tokens with configurable TTL
  - Secure token generation and validation
  - Automatic session invalidation on logout

#### OAuth 2.0 Implementation
- **Split Client Architecture**
  - Separate OAuth clients for authentication vs. provider access
  - Minimal scopes for each client
  - PKCE for public clients
  - Secure token storage with encryption

### Data Protection

#### At Rest Encryption
- **AES-256-GCM** with random IVs when `VX_MAILAGENT_KEY` is a valid 64‑char hex key; plaintext JSON in development when unset/invalid.
- Secure key management via environment variables; no hardcoded keys.
- Key rotation: not implemented; rotate by re‑encrypting data offline if required.

#### In-Transit Security
- Deployment: terminate TLS (TLS 1.2+) at proxy/load balancer
- Backend: redirects HTTP→HTTPS and sets HSTS in production
- Certificate pinning: deployment-specific (not implemented in code)
- Cipher suites: deployment-specific (configure at TLS terminator)

### Access Control

#### User Isolation
- Each user gets isolated data storage
- Strict path validation
- No symlink or path traversal allowed
- Containerized execution environments

#### API Security
- Input validation (path safety and user-context checks; limited schema validation). A minimal JSON Schema subset validator exists in `src/backend/validation.ts` and is used only by tool-call handlers in `src/backend/toolCalls.ts` to validate tool parameters.
- Output encoding (general practice)
- Rate limiting (not implemented)
- Request validation middleware (planned)
- CSRF protection (not implemented; SameSite=Lax cookies mitigate cross-site requests)

### Audit & Monitoring

#### Logging
- Structured JSON logs
- User context in all entries
- Sensitive data redaction in traces via `TRACE_REDACT_FIELDS`; avoid logging secrets elsewhere
- Immutable audit trail

#### Retention & Pruning
- Traces: retention TTL controlled by `TRACE_TTL_DAYS`; per-user cap enforced by `USER_MAX_LOGS_PER_TYPE`.
- Provider events: retention TTL controlled by `PROVIDER_TTL_DAYS`; per-user cap enforced by `USER_MAX_LOGS_PER_TYPE`.
- Orchestration and fetcher logs: retention TTLs controlled by `ORCHESTRATION_TTL_DAYS` and `FETCHER_TTL_DAYS`; per-user cap enforced by `USER_MAX_LOGS_PER_TYPE`.
- There are no global repositories or global max-count environment variables.

#### Monitoring
- Security event monitoring
- Anomaly detection
- Automated alerts
- Incident response procedures
- Implemented routes include health, prompts, prompt-templates, conversations, accounts, directors, agents, filters, memory, settings, fetcher, diagnostics, and workspaces. Some live tools (calendar/todo/filesystem/memory) described below are planned and may not be wired as HTTP APIs yet.
- Route composition uses a generic CRUD routes helper for common resources to reduce duplication; resource-specific validation/transform/sanitization are provided via callbacks.

Core Concept: For each routed email, a director AI orchestrates specialized agents via tool-calls and inter-agent messaging. All agents work in a shared Workspace for that email (scoped to the director thread), where they add, list and remove items. The director decides next actions and completes the run; the Workspace is the deliverable. There is no explicit "finalize" flag — completion is implicit when loops end.

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

## 4. API Design

### Authentication
- JWT-based authentication
- OAuth 2.0 for provider access
- Session management with refresh tokens

### Rate Limiting (planned; not implemented)
- Global, per-user, and per-endpoint strategies may be added or enforced at an API gateway or reverse proxy

### Error Handling
- Standardized error responses
- Detailed error codes
- User-friendly messages
- Logging and monitoring

### Versioning
- Not currently versioned; single API surface. Future: semantic and path versioning with deprecation policy.

### Data Validation
 - Limited validation: path safety and user-context checks across routes; plus a minimal JSON Schema subset validator in `src/backend/validation.ts` used exclusively by `src/backend/toolCalls.ts` for tool parameter validation. There is no global schema validation middleware.
 - Planned: request schema validation middleware, input sanitization, and output filtering.

## 5. Technical Design
### 5.1 Architecture
- **Single Application**: A single Node.js application (TypeScript) with Express.js serves a React frontend (bundled via Vite) and handles all logic: email fetching, filtering, orchestration, tool calls, and OpenAI API integration. Frontend communicates with backend via standard HTTP requests (e.g., `fetch`), avoiding IPC or complex protocols (e.g., WebSocket, GraphQL).
- **Clean Dependency Injection**: All route modules use `LiveRepos` interface directly, eliminating wrapper bloat and redundant dependency interfaces. Service functions passed explicitly where needed.
- **Route Helpers (CRUD)**: Shared helper constructs standard list/get/create/update/delete endpoints with optional reorder; used by `agents`, `directors`, `filters`, and `imprints` route modules.
- **Backend**: Node.js with Express.js for routing, email processing, tool calls, and persistence.
- **Frontend**: React with HTML/JavaScript/CSS, styled with Tailwind CSS for a professional look, using Material-UI (or similar) for components (modals, tables, buttons) to ensure developer/user-friendliness.
- **Persistence**: Encrypted JSON files store configurations, filters, signatures, virtual root, and memories.
- **Email Access**: Gmail API (`googleapis`) and Microsoft Graph API (`msal-node`) for email, calendar, and to-do access.
- **AI Integration**: OpenAI API (`openai` library) for director-led orchestration and agent tasks, using function-calling (tools, `tool_choice`).
- **OS Functions**: Node.js `fs` and `path` modules for file system access, restricted to virtual root.

## User Isolation

**CRITICAL SECURITY ARCHITECTURE**: The system enforces strict per-user data isolation with zero tolerance for data leakage:

- **Authentication**: JWT-based sessions with Google OAuth2 OIDC for login
- **User Context**: Middleware attaches `{ uid, repos }` to authenticated requests
- **Repository Registry**: Per-user repository bundles with TTL-based eviction
- **Path Safety**: User paths validated under `DATA_DIR/users/{uid}/` with 0700 permissions
- **Zero Global Fallbacks**: All data access requires user context; throws errors if missing
- **Global Data Restriction**: Only `users.json` permitted as global application data

### Isolation Enforcement

- **LiveRepos Interface**: Canonical source of truth for all repository access methods; eliminates wrapper bloat
- **Direct Repository Access**: All route modules accept `LiveRepos` directly instead of verbose wrapper objects
- **Service Parameter Pattern**: Routes requiring additional services accept explicit `services` parameters with typed method signatures
- **No Wrapper Interfaces**: All `*RoutesDeps` interfaces eliminated in favor of direct `LiveRepos` usage
- **Settings Service**: Requires user context for all operations; no global settings access
- **Logging Service**: All logging functions require user context parameter; no global repositories
- **Route Dependencies**: All routes pass `LiveRepos` and services directly to route handlers
- **Path Constants**: Only `USERS_FILE` constant exists; all other global file constants removed
- **Repository Implementations**: Repositories operate in per-user mode only; legacy global helpers and mode flags were removed. Max-item caps are enforced per user via `USER_MAX_LOGS_PER_TYPE`.
- **Fetcher Manager**: Per-user instances accepting `LiveRepos` and service functions directly

Data files are organized as:
```
data/
├── users.json              # Global user registry (login data only - NOT exposed via UI/API)
└── users/{uid}/            # Per-user isolated data
    ├── accounts.json
    ├── settings.json
    ├── conversations.json
    ├── workspaceItems.json
    └── logs/
        ├── fetcher.json
        ├── orchestration.json
        ├── provider-events.json
        └── traces.json
```

### 3.2 Components
#### 3.2.0 Tools, Delegation, and Diagnostics

* **Tools (single source of truth)**: Defined in `src/shared/tools.ts` and exposed to the model via a single spec builder. There are two categories:
  - Mandatory: always available (e.g., workspace operations, meta discovery like `list_agents`, `list_tools`, `describe_tool`, `read_api_docs`).
  - Optional: exposed only when explicitly enabled per director/agent settings.
* **Delegation**: Implemented with a single `delegate_to_agent` tool. Directors use this tool to assign work to agent threads. Dynamic per-agent tools (e.g., `agent__{id}`) are deprecated and removed from injection to prevent drift and simplify validation.
* **Router**: All tool calls go through a single router (`src/backend/toolCalls.ts`) which validates inputs (JSON schema + semantics), enforces execution timeouts, and returns structured results.

#### 3.2.0a Diagnostics vs Workspace Results

* **Diagnostics**: Admin/debug only. Includes structured debug artifacts such as function returns and provider payload summaries.
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
  - `GET /api/workspaces/:id/items/:itemId` — get one item.
  - `PUT /api/workspaces/:id/items/:itemId` — update with `expectedRevision`.
  - `DELETE /api/workspaces/:id/items/:itemId` — remove item; `?hard=true` for hard-delete (default soft).
  - Note: Creation of items is performed by orchestration only. There is no REST create endpoint.
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
- Provider OAuth endpoints under `/api/accounts/oauth/*` (Google/Outlook) are protected by `requireAuth`. Linking provider accounts is an authenticated action.
- Production: trust proxy, redirect HTTP→HTTPS, set HSTS.

###### Re-authorization Flow for Gmail/Outlook Tokens

- For Gmail/Outlook provider accounts, token refresh or API probe failures that require user action return `{ ok: false, error: <category>, reauthUrl }` from `src/backend/routes/accounts.ts`.
- Error categories include: `missing_refresh_token`, `invalid_grant`, `network`, `other`. The frontend surfaces a re-authenticate action using the provided URL.
- Structured JSON logs capture the error category and context; info-level events log when a re-auth URL is generated.
  - Related endpoints for probes: `GET /api/accounts/:id/gmail-test` and `GET /api/accounts/:id/outlook-test`.

#### 3.2.3 Director Orchestration
- **Functionality**: Receive filtered emails and initialize a conversation using the director’s prompt and `ApiConfig`. The director’s model is in control and uses function-calling to invoke tools (calendar, to-do, filesystem, memory) and to message specialized agents via per-agent tools. Agents are not invoked independently.
- **Configuration**: `{ id, name, promptId, apiConfigId, agentIds: string[], enabledToolCalls?: string[] }`.
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
  - **Memory**: Search/add/edit semi-structured memories (see `MemoryEntry` in `src/shared/types.ts`: `{ id, scope, content, created, updated, tags?, relatedEmailId?, owner?, metadata? }`); search cascades (local→global), additions specify scope.
  - **Output**: Text (plain, markdown, rich text) or images; tool outputs (e.g., file content, memory entries) included only if agent specifies (e.g., in reply text or as attachments).
  - **Configuration**: Agent objects use `{ id, name, type: 'openai', promptId, apiConfigId, enabledToolCalls?: string[] }`.
  - **Implementation**: Uses OpenAI’s function-calling API for tasks/tools. Tool outputs are processed by the agent’s prompt logic.

#### 3.2.5 Processing Pipeline
- **Functionality**: Fetcher queues emails, processed in parallel across accounts/directors. Directors pass emails/outputs to agents, collecting results. Tool calls validated (e.g., file access within virtual root) with transparent logging (e.g., `console.log("File access denied")`).
- **Implementation**: Uses Node.js async (e.g., `Promise.all`) for parallel processing, respects external provider API rate limits (OpenAI, Gmail, Microsoft Graph). Errors trigger UI alerts and are logged via the backend logger (`src/backend/services/logger.ts`).

#### 3.2.6 UI
 - **Layout**: The Results page is the primary user-facing view and renders the director-thread-scoped Workspace Items. A separate Conversations view exists as a debug tool to inspect director/agent transcripts and tool calls. Diagnostics is a separate admin panel focused on the audit/process trail and must not re‑render the user result view.
  - **Components**:
  - **Accounts**: Modal for OAuth, signature preview/edit (text area showing provider default or custom).
  - **API Settings**: Form to add/edit OpenAI keys/models.
  - **Directors/Agents**: Forms for prompts, imprints, tool selection; drag-and-drop for agent ordering.
  - **Filters**: Dropdown for fields, regex input, help link with examples (e.g., `from:client.*@domain\.com`, `Subject: urgent.*`).
  - **Memory**: Searchable table for global/local entries, with edit/delete/scope-switching buttons.
  - **Settings**: Text field for virtual root (e.g., `/home/jane/client_docs`).
  - **Results (Workspace-centric)**:
    - Left navigation tree: emails → directors → workspace items.
      - Selecting an email: right pane shows the aggregated workspace view for that email (summary list/grid of its `WorkspaceItem`s). This is the canonical user result.
      - Selecting a director: right pane may show the chat thread with that director under the selected email (when enabled) for debugging. Tool-call messages are rendered with structured visualization (chips + formatted payloads); no empty bubbles.
      - Selecting a workspace item: right pane shows a MIME-aware preview (markdown/HTML for text, image previews, file chips, formatted JSON for structured content). Chat is hidden in this mode.
    - The original email panel is collapsed by default; it can be toggled to show snippet/body/attachments.
    - Toolbar: Refresh, Delete active, Delete selected/all; per-row delete with confirmation. Wired to existing backend endpoints. Diagnostics/admin controls remain separate.
    - Canonical component: `src/frontend/src/Conversations.tsx`.

  - **Conversations (Debug tool)**:
    - Hierarchical presentation associating a director thread with its agent threads.
    - Detail panel shows the OpenAI-aligned transcript and tool-call visualizations to help users debug the director/agent actions.
    - This view is auxiliary and not the canonical user result display; Workspace Items on the Results page are the primary deliverables.
  - **Diagnostics (Admin/Debug)**:
    - Two-pane layout with resizable splitter. Left: grouped/flat tree of cycles and threads. Right: detail tabs (see below).
    - Grouping and attribution are strictly canonical, using only: `fetchCycleId`, `dirThreadId`, `agentThreadId` (and `phase` for labeling). No heuristic fix-ups.
    - Director entries and agent subtrees are interleaved by timestamp to reflect the true event sequence. Agent subtree anchors use the director invocation event timestamp (`detail.tool === 'agent'` with `detail.sessionId` matching the `agentThreadId`); if absent, fallback to the first agent event timestamp.
    - Left pane: toggle between Grouped and Flat views; hierarchical accordions for director and agent nodes; click-to-activate sets the active event.
    - Right pane tabs (order is mandatory): [Result, Email].
      - Result: shows the structured result payload (if present) and Diagnostic detail as JSON for debugging. This does not re-render the user-facing Result View.
      - Email: shows headers, snippet, and attachments for the originating email, with a toggle to view raw JSON.
    - Delete controls: per-entry delete and bulk delete are available; operations use the Diagnostics endpoints.
  - **Workspace**: Conversation detail view renders the workspace item list (type, provenance, tags, preview, created/updated, revision) with controls to Update/Remove (create is via orchestration tools). Wired to:
    - `GET /api/workspaces/:id/items`
    - [no REST create endpoint — creation is performed by orchestration tools]
    - `PUT /api/workspaces/:id/items/:itemId`
    - `DELETE /api/workspaces/:id/items/:itemId[?hard=true]`
  - **Notifications**: Browser Notification API (e.g., “Processing complete for email ID:123”).
  - **Implementation**: React with Tailwind CSS for styling, Material-UI (or similar) for professional components, communicates with backend via HTTP (e.g., `fetch`).
  - **Shared Components**: `MessageListEditor` (`src/frontend/src/components/MessageListEditor.tsx`) centralizes CRUD operations for prompt/template message arrays; dialogs such as `PromptEditDialog` and `TemplateEditDialog` consume it with configuration (default role, variable insertion, i18n labels).

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
  - Agent messaging: per-agent tools exposed as `agent__<id>` for assigned agents only.
  - Workspace tools: `workspace_add_item`, `workspace_list_items`, `workspace_get_item`, `workspace_update_item`, `workspace_remove_item`.
  - Live tools (as available): `calendar_read`, `calendar_add`, `todo_add`, `filesystem_search`, `filesystem_retrieve`, `memory_search`, `memory_add`, `memory_edit`.
  - Effective registry: mandatory tools always on; optional tools filtered by `director.enabledToolCalls`.
  - Dynamic `agent__<id>` tools limited to `director.agentIds` when provided.
  - Tool names/schemas: see `src/shared/tools.ts`. Provider actions are handled by `src/backend/toolCalls.ts`.
  - Agent delegation call ensures or creates an agent child `ConversationThread`, runs the agent loop (bounded steps), and returns a summary `{ status, agentThreadId }` as a director tool message.
- **Lifecycle**:
  - Within a director conversation, each agent is reused via a single child agent thread when invoked repeatedly.
  - No explicit session object or timeout semantics. Completion is implicit when loops end or step limits are reached.
  - `ConversationThread.status` uses `ongoing | completed | failed | cancelled | timeout` with `startedAt`, optional `endedAt`, and `lastActiveAt`.
  - There is no `finalized` flag and no `expired` status.
- **Traceability**: Each `ConversationThread` (director/agent) maintains a canonical OpenAI-aligned transcript in `messages[]`. Provider requests/responses/errors are appended as separate `ProviderEvent` entries (request/response/error) with timestamps, usage, and latency. Diagnostics endpoints expose these events; the user-facing chat derives solely from the canonical transcript.

 - **Invariants**:
   - A director thread is never reused across emails/runs; exactly one director thread per (emailId × directorId).
   - All workspace operations are scoped to the director thread id (`conversationId`); agents write into the director’s workspace.
   - Tool registry: dynamic `agent__<id>` tools only for the director’s assigned agents; optional tools gated by `enabledToolCalls`; mandatory tools are always available.
   - Transcript cadence is OpenAI-aligned: assistant with `tool_calls[]` → one tool message per call (matching `tool_call_id`) → next assistant.

#### 3.2.8b OpenAI Tools and Canonical Signatures

- **Discovery (Director)**
  - `list_agents()` → returns assigned agents: `[{ id, name, summary?, apiConfigId }]`.
  - `list_tools()` → returns currently available tools for the director context: `[{ name, description, paramsSummary }]`.
  - `tool_help(name)` → returns detailed help for a tool (purpose, parameters, examples).

- **Agent Messaging (Director)**
  - Per-agent tools exposed as `agent__<slugOrId>` share the same signature:
    - Input: `{ input: string; sessionId?: string; options?: { allowTools?: boolean; toolFilter?: string[] } }` (`input` required).
    - Output: `{ sessionId: string; output: string; toolCalls: [{ name: string; args: any; success: boolean; error?: string }]; done?: boolean }`.
  - Director-side summary embedded in the transcript (tool message content) is JSON-stringified and may use a compact shape: `{ status: 'completed' | 'failed', agentThreadId }`.

- **Workspace (Common and Director-only)**
  - Common (director + agents):
    - `workspace_add_item(label?, description?, mimeType?, encoding?, data?, tags?)` → `{ item }`
    - `workspace_list_items()` → `{ items[] }`
    - `workspace_get_item(id)` → `{ item }`
    - `workspace_update_item(id, patch, expectedRevision?)` → `{ item }`
    - `workspace_remove_item(id, hardDelete?)` → `{ removed: true }`
    - Access: All participants (director and agents) may add, list, update, and remove any workspace item. `hardDelete` is available to all participants.
  - Tool message content uses `JSON.stringify(result)` for transcript tool messages. Canonical result shapes:
    - Success: `{ ok: true, item }` or `{ ok: true, items }`.
    - Error: `{ ok: false, error }`.

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

## Appendix A — Configuration Defaults (Final Product)

The following are system defaults and are configurable via environment variables. Source of truth: `src/backend/config.ts`.

- Timeouts (milliseconds)
  - `OPENAI_REQUEST_TIMEOUT_MS`: 30000
  - `GRAPH_REQUEST_TIMEOUT_MS`: 15000
  - `PROVIDER_REQUEST_TIMEOUT_MS`: 30000
  - `CONVERSATION_STEP_TIMEOUT_MS`: 45000
  - `TOOL_EXEC_TIMEOUT_MS`: 30000

- Retention (days)
  - `TRACE_TTL_DAYS`: 7
  - `PROVIDER_TTL_DAYS`: 7
  - `FETCHER_TTL_DAYS`: 7
  - `ORCHESTRATION_TTL_DAYS`: 7

- Trace payload controls
  - `TRACE_MAX_PAYLOAD`: 32768 bytes per payload
  - `TRACE_MAX_SPANS`: 1000
  - `TRACE_REDACT_FIELDS` (default list): authorization, api_key, access_token, refresh_token, set-cookie, cookie

- Limits and multi-user caps
  - `USER_MAX_FILE_SIZE_MB`: 50
  - `USER_MAX_CONVERSATIONS`: 10000
  - `USER_MAX_LOGS_PER_TYPE`: 10000

- Encryption at rest
  - `VX_MAILAGENT_KEY` (64-char hex) enables AES-256-GCM. If missing/invalid, plaintext mode is used (logged warning) for development.

Notes:
- All values above are per-user where applicable (logs, conversations). There are no global data caps beyond the user registry.
- Director thread lifecycle statuses are `ongoing | completed | failed | cancelled | timeout` (no finalize flag, no expired status).

## Appendix B — Canonical Examples

These examples illustrate final, unambiguous shapes. Field omissions are intentional when optional.

### Director
```json
{
  "id": "dir-123",
  "name": "Client Manager",
  "promptId": "prm-director-001",
  "apiConfigId": "cfg-openai-001",
  "agentIds": ["ag-reply", "ag-analysis"],
  "enabledToolCalls": [
    "workspace_add_item",
    "workspace_update_item",
    "memory_search",
    "memory_add"
  ]
}
```

### Agent
```json
{
  "id": "ag-reply",
  "name": "Reply Writer",
  "type": "openai",
  "promptId": "prm-agent-reply",
  "apiConfigId": "cfg-openai-001",
  "enabledToolCalls": [
    "filesystem_search",
    "workspace_add_item",
    "memory_search"
  ]
}
```

### ApiConfig
```json
{
  "id": "cfg-openai-001",
  "name": "OpenAI Default",
  "model": "gpt-4o-mini",
  "apiKey": "sk-...",
  "maxOutputTokens": 1024
}
```

### Filter
```json
{
  "id": "flt-urgent",
  "field": "subject",
  "regex": "urgent|asap|immediately",
  "duplicateAllowed": false,
  "directorId": "dir-123"
}
```

### MemoryEntry (global)
```json
{
  "id": "mem-1",
  "scope": "global",
  "content": "ACME escalation policy v2",
  "tags": ["policy", "acme"],
  "created": "2025-09-08T10:00:00Z",
  "updated": "2025-09-08T10:00:00Z"
}
```

### MemoryEntry (local — agent-owned)
```json
{
  "id": "mem-2",
  "scope": "local",
  "owner": { "type": "agent", "id": "ag-reply" },
  "content": "Tone: courteous but concise",
  "tags": ["style"],
  "relatedEmailId": "gmail:1789a...",
  "created": "2025-09-08T10:05:00Z",
  "updated": "2025-09-08T10:05:00Z",
  "metadata": { "source": "guidelines-v3" }
}
```

### WorkspaceItem (director-thread scoped)
```json
{
  "id": "ws-77",
  "label": "Draft reply to ACME",
  "description": "First-pass response",
  "mimeType": "text/markdown",
  "encoding": "utf8",
  "data": "## Re: ACME Support\n...",
  "tags": ["draft_reply"],
  "revision": 3,
  "deleted": false,
  "created": "2025-09-08T10:10:00Z",
  "updated": "2025-09-08T10:11:00Z",
  "context": {
    "email": { "id": "gmail:1789a...", "subject": "Escalation", "from": "ops@acme.com", "date": "2025-09-08T09:57:00Z" },
    "director": { "id": "dir-123" },
    "agent": { "id": "ag-reply" },
    "createdBy": "agent",
    "tool": "workspace_add_item",
    "conversationId": "thread-dir-abc"
  }
}
```

### Tool Result Shapes (transcript tool messages)
```json
{ "ok": true, "item": { /* WorkspaceItem */ } }
```
```json
{ "ok": true, "items": [ /* WorkspaceItem[] */ ] }
```
```json
{ "ok": false, "error": "message" }
```
```json
{ "status": "completed", "agentThreadId": "agt-123" }
