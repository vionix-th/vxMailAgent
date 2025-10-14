import logger from '../services/logger';
import { ToolHandlerRegistrar, ToolExecutionRuntime } from './types';
import { ToolCallResult } from '../../shared/types';

export function registerCalendarHandlers(register: ToolHandlerRegistrar) {
  register('calendar_read', calendarExecutor('calendar_read', 'read'));
  register('calendar_add', calendarExecutor('calendar_add', 'add'));
}

const calendarExecutor = (toolName: string, action: 'read' | 'add') => async ({ params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  logger.info('[TOOLCALL] calendar (not_implemented)', { action, params });
  return { kind: toolName, success: false, result: null, error: 'not_implemented' };
};
