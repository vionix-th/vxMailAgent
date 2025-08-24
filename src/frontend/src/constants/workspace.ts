// Canonical workspace item types for the frontend UI.
// Keep this list in sync with src/shared/types.ts: WORKSPACE_ITEM_TYPES.
export const WORKSPACE_ITEM_TYPES = [
  'text',
  'draft_reply',
  'attachment',
  'file',
  'image',
  'html',
  'markdown',
  'json',
  'tool_output',
  'error',
] as const;

export type WorkspaceItemTypeUI = typeof WORKSPACE_ITEM_TYPES[number];
