import { ToolCallResult } from '../shared/types';
import { validateAgainstSchema } from './validation';
import { TOOL_REGISTRY } from '../shared/tools';
import { TOOL_EXEC_TIMEOUT_MS } from './config';
import logger from './services/logger';
import type { RepoBundle } from './repository/registry';
import { registerMetaHandlers } from './tool-handlers/meta';
import { registerWorkspaceHandlers } from './tool-handlers/workspace';
import { registerCalendarHandlers } from './tool-handlers/calendar';
import { registerFilesystemHandlers } from './tool-handlers/filesystem';
import { registerTodoHandlers } from './tool-handlers/todo';
import { registerMemoryHandlers, handleMemoryToolCall } from './tool-handlers/memory';
import type { ToolExecutor, ToolHandlerRegistrar, ToolCallExecutionContext } from './tool-handlers/types';

export function createToolHandler(repos: RepoBundle) {
  const dispatcher = new Map<string, ToolExecutor>();
  const register: ToolHandlerRegistrar = (name, executor) => {
    dispatcher.set(name, executor);
  };

  registerMetaHandlers(register);
  registerCalendarHandlers(register);
  registerFilesystemHandlers(register);
  registerTodoHandlers(register);
  registerMemoryHandlers(register);
  registerWorkspaceHandlers(register);

  const handleToolByName = async (name: string, params: any, context?: ToolCallExecutionContext): Promise<ToolCallResult> => {
    const spec = TOOL_REGISTRY.find((tool) => tool.name === name) || null;
    if (!spec) {
      return { kind: name, success: false, result: null, error: 'Unknown tool name' };
    }
    const validationErrors: string[] = validateAgainstSchema(spec.parameters, params);
    const semanticErrors = validateToolSemantics(name as any, params);
    const allErrors = [...validationErrors, ...semanticErrors];
    if (allErrors.length) {
      return { kind: name, success: false, result: { ok: false, errors: allErrors, received: sanitize(params) }, error: 'Invalid tool params' };
    }

    const executor = dispatcher.get(name);
    if (!executor) {
      return { kind: name, success: false, result: null, error: 'tool not implemented' };
    }

    const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
      let timeoutId: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`tool_exec_timeout_${TOOL_EXEC_TIMEOUT_MS}ms`)), Math.max(1, TOOL_EXEC_TIMEOUT_MS || 0));
          }),
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    };

    try {
      const result = await executor({
        repos,
        params,
        context,
        withTimeout,
        handleToolByName: (toolName, toolParams, toolContext) => handleToolByName(toolName, toolParams, toolContext),
      });
      return result;
    } catch (error: any) {
      const message = error?.message || String(error);
      logger.error('Tool call execution failed', {
        tool: name,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        params: sanitize(params),
        workspace: context?.workspace?.conversationId,
      });
      return { kind: name, success: false, result: null, error: message };
    }
  };

  return handleToolByName;
}

function sanitize(obj: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined;
  }
}

function baseKind(kind: string): string {
  if (!kind) return '';
  if (kind.startsWith('calendar_')) return 'calendar';
  if (kind.startsWith('filesystem_')) return 'filesystem';
  if (kind.startsWith('todo_')) return 'todo';
  if (kind.startsWith('memory_')) return 'memory';
  if (kind.startsWith('workspace_')) return 'workspace';
  return kind;
}

function validateToolSemantics(kind: string, payload: any): string[] {
  const errors: string[] = [];
  const base = baseKind(kind);
  if (base === 'calendar') {
    if (payload.action === 'read') {
      if (!payload.dateRange || typeof payload.dateRange.start !== 'string' || typeof payload.dateRange.end !== 'string') {
        errors.push('calendar: read requires dateRange.start and dateRange.end strings');
      }
    } else if (payload.action === 'add') {
      const event = payload.event || {};
      if (!event || typeof event.title !== 'string' || typeof event.start !== 'string' || typeof event.end !== 'string') {
        errors.push('calendar: add requires event.title, event.start, event.end strings');
      }
    }
  } else if (base === 'filesystem') {
    if (payload.action === 'search') {
      if (typeof payload.query !== 'string') errors.push('filesystem: search requires query string');
    } else if (payload.action === 'retrieve') {
      if (typeof payload.filePath !== 'string') errors.push('filesystem: retrieve requires filePath string');
    }
  } else if (base === 'todo') {
    if (payload.action !== 'add') errors.push('todo: only action add is supported');
    else if (!payload.task || typeof payload.task.title !== 'string') errors.push('todo: add requires task.title string');
  } else if (base === 'memory') {
    if (payload.action === 'edit') {
      if (!payload.entry || typeof payload.entry !== 'object' || typeof payload.entry.id !== 'string') {
        errors.push('memory: edit requires entry.id string');
      }
    } else if (payload.action === 'add') {
      if (!(payload.entry && typeof payload.entry === 'object') && !(typeof payload.content === 'string' || typeof payload.query === 'string')) {
        errors.push('memory: add requires entry object or content/query string');
      }
    }
  }
  return errors;
}

export { handleMemoryToolCall };
