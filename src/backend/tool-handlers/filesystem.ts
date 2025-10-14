import logger from '../services/logger';
import { ToolHandlerRegistrar, ToolExecutionRuntime } from './types';
import { ToolCallResult } from '../../shared/types';

export function registerFilesystemHandlers(register: ToolHandlerRegistrar) {
  register('filesystem_search', filesystemExecutor('filesystem_search', 'search'));
  register('filesystem_retrieve', filesystemExecutor('filesystem_retrieve', 'retrieve'));
}

const filesystemExecutor = (toolName: string, action: 'search' | 'retrieve') => async ({ params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  logger.info('[TOOLCALL] filesystem (not_implemented)', { action, params });
  return { kind: toolName, success: false, result: null, error: 'not_implemented' };
};
