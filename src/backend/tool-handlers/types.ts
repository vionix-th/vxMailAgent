import type { ToolCallResult } from '../../shared/types';
import type { RepoBundle } from '../repository/registry';

export interface ToolCallExecutionContext {
  workspace?: {
    conversationId: string;
    createdBy?: 'director' | 'agent' | 'tool';
    creatorId?: string;
    emailId?: string;
    toolName?: string;
  };
}

export interface ToolExecutionRuntime {
  repos: RepoBundle;
  params: any;
  context?: ToolCallExecutionContext;
  withTimeout<T>(promise: Promise<T>): Promise<T>;
  handleToolByName(name: string, params: any, context?: ToolCallExecutionContext): Promise<ToolCallResult>;
}

export type ToolExecutor = (runtime: ToolExecutionRuntime) => Promise<ToolCallResult>;

export type ToolHandlerRegistrar = (name: string, executor: ToolExecutor) => void;
