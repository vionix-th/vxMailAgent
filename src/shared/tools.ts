/**
 * Canonical tool registry shared by backend and frontend.
 * Provides a single source of truth for tool metadata and schemas.
 */
import { ToolDescriptor } from './types';

export type ToolCategory = 'mandatory' | 'optional';

export interface ToolSpec {
  name: string;
  category: ToolCategory;
  description: string;
  parameters: any;
}

export const TOOL_REGISTRY: ToolSpec[] = [
  // Discovery/meta (mandatory)
  { name: 'list_agents', category: 'mandatory', description: 'List agents assigned to this director. Returns [{ id, name, apiConfigId }].', parameters: { type: 'object', properties: {} } },
  { name: 'list_tools', category: 'mandatory', description: 'List available tools for the current context.', parameters: { type: 'object', properties: {} } },
  { name: 'describe_tool', category: 'mandatory', description: 'Describe a tool (parameters JSON schema and description).', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'read_api_docs', category: 'mandatory', description: 'Retrieve small relevant doc snippets for the given query from curated sources.', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number' } }, required: ['query'] } },
  { name: 'validate_tool_params', category: 'mandatory', description: 'Validate params against the tool\'s JSON schema, returning errors if any.', parameters: { type: 'object', properties: { name: { type: 'string' }, params: { type: 'object' } }, required: ['name', 'params'] } },
  // Workspace (mandatory)
  { name: 'workspace_add_item', category: 'mandatory', description: 'Add an item to the shared workspace. Optional display metadata: label, description, mimeType, encoding, data.', parameters: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' }, mimeType: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64', 'binary'] }, data: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } },
  { name: 'workspace_list_items', category: 'mandatory', description: 'List all items in the shared workspace.', parameters: { type: 'object', properties: {} } },
  { name: 'workspace_get_item', category: 'mandatory', description: 'Get a single workspace item by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'workspace_update_item', category: 'mandatory', description: 'Update fields on a workspace item.', parameters: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' }, expectedRevision: { type: 'number' } }, required: ['id', 'patch'] } },
  { name: 'workspace_remove_item', category: 'mandatory', description: 'Remove a workspace item.', parameters: { type: 'object', properties: { id: { type: 'string' }, hardDelete: { type: 'boolean' } }, required: ['id'] } },

  // Optional tools (live integrations)
  { name: 'calendar_read', category: 'optional', description: 'Read calendar events through the configured provider API.', parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['gmail', 'outlook'] }, accountId: { type: 'string' }, dateRange: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } }, required: ['start','end'] } }, required: ['provider','accountId','dateRange'] } },
  { name: 'calendar_add', category: 'optional', description: 'Add a calendar event through the configured provider API.', parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['gmail', 'outlook'] }, accountId: { type: 'string' }, event: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, location: { type: 'string' } }, required: ['title','start','end'] } }, required: ['provider','accountId','event'] } },
  { name: 'todo_add', category: 'optional', description: 'Add a to-do task via the provider API.', parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['gmail', 'outlook'] }, accountId: { type: 'string' }, task: { type: 'object', properties: { title: { type: 'string' }, dueDate: { type: 'string' }, notes: { type: 'string' } }, required: ['title'] } }, required: ['provider','accountId','task'] } },
  { name: 'filesystem_search', category: 'optional', description: 'Search files within the configured virtual root.', parameters: { type: 'object', properties: { virtualRoot: { type: 'string' }, query: { type: 'string' } }, required: ['virtualRoot','query'] } },
  { name: 'filesystem_retrieve', category: 'optional', description: 'Retrieve a file within the configured virtual root.', parameters: { type: 'object', properties: { virtualRoot: { type: 'string' }, filePath: { type: 'string' } }, required: ['virtualRoot','filePath'] } },
  { name: 'memory_search', category: 'optional', description: 'Search semi-structured memory entries with cascading scope.', parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['global', 'shared', 'local'] }, owner: { type: 'string' }, tag: { type: 'string' }, query: { type: 'string' } } } },
  { name: 'memory_add', category: 'optional', description: 'Add a semi-structured memory entry.', parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['global', 'shared', 'local'] }, entry: { type: 'object' }, content: { type: 'string' }, owner: { type: 'string' }, tag: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } },
  { name: 'memory_edit', category: 'optional', description: 'Edit a memory entry by id.', parameters: { type: 'object', properties: { entry: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, required: ['entry'] } },
];

export const CORE_TOOL_NAMES: string[] = TOOL_REGISTRY.filter(t => t.category === 'mandatory').map(t => t.name);
export const OPTIONAL_TOOL_NAMES: string[] = TOOL_REGISTRY.filter(t => t.category === 'optional').map(t => t.name);
/**
 * Flags-based descriptors derived from the registry for selective tool exposure.
 */
export const TOOL_DESCRIPTORS: ToolDescriptor[] = TOOL_REGISTRY.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.parameters,
  flags: {
    mandatory: t.category === 'mandatory',
    defaultEnabled: t.category === 'optional',
  },
}));

