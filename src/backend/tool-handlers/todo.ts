import logger from '../services/logger';
import { ToolHandlerRegistrar, ToolExecutionRuntime } from './types';
import { ToolCallResult } from '../../shared/types';

export function registerTodoHandlers(register: ToolHandlerRegistrar) {
  register('todo_add', todoExecutor('todo_add'));
}

const todoExecutor = (toolName: string) => async ({ params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  logger.info('[TOOLCALL] todo (not_implemented)', { params });
  return { kind: toolName, success: false, result: null, error: 'not_implemented' };
};
