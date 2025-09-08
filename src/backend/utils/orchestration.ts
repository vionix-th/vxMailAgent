import { OrchestrationDiagnosticEntry, EmailEnvelope, ConversationThread, WorkspaceItem } from '../../shared/types';
import * as persistence from '../persistence';
import { newId } from './id';

/**
 * Minimal base input used to construct an orchestration diagnostic entry.
 */
export type OrchBaseInput = {
  director: string;
  directorName?: string;
  agent?: string;
  agentName?: string;
  emailSummary: string;
  accountId?: string;
  email?: EmailEnvelope;
  fetchCycleId?: string;
  dirThreadId?: string;
  agentThreadId?: string;
};

/**
 * Build the fixed portion of an orchestration diagnostic entry.
 * Consumers typically spread this into the final object and add { detail, result, error, phase }.
 */
export function buildOrchBase(
  input: OrchBaseInput
): Omit<OrchestrationDiagnosticEntry, 'detail' | 'result' | 'error' | 'phase'> {
  return {
    timestamp: new Date().toISOString(),
    director: input.director,
    directorName: input.directorName,
    agent: input.agent ?? '',
    agentName: input.agentName ?? '',
    emailSummary: input.emailSummary,
    accountId: input.accountId,
    email: input.email,
    fetchCycleId: input.fetchCycleId,
    dirThreadId: input.dirThreadId,
    agentThreadId: input.agentThreadId,
  };
}

/**
 * Resolve a director thread by id or throw when it does not exist.
 */
export function resolveDirThread(
  conversations: ConversationThread[],
  dirThreadId: string
): { index: number; thread: ConversationThread } {
  const index = conversations.findIndex(c => c.id === dirThreadId);
  if (index === -1) throw new Error('director thread not found');
  return { index, thread: conversations[index] };
}

/**
 * Deprecated embedding: returns an empty list. Workspace items live in the Workspaces repository.
 */
export function getWorkspace(_thread: ConversationThread): WorkspaceItem[] {
  return [];
}

/**
 * No-op setter retained for compatibility with historical call sites. Conversations do not carry workspace items.
 */
export async function setWorkspace(
  conversations: ConversationThread[],
  _index: number,
  _items: WorkspaceItem[],
  conversationsFilePath: string
): Promise<void> {
  try {
    await persistence.encryptAndPersist(conversations, conversationsFilePath);
  } catch {}
}

/**
 * Normalize an unknown error into a structured object suitable for diagnostics.
 */
export function normalizeError(e: any, detail?: any) {
  const asAny = e as any;
  return {
    message: String(asAny?.message || asAny),
    stack: asAny?.stack,
    detail,
  };
}

/** Callback used to emit orchestration diagnostic entries. */
export type OrchLogger = (entry: OrchestrationDiagnosticEntry) => void;

/**
 * Run an async tool operation with standardized diagnostics for start/success/error.
 * The `run` callback may return `{ result, detail, output }`.
 */
export async function withOrchToolLogging<TOutput = any>(
  logger: OrchLogger,
  base: OrchBaseInput,
  detail: any,
  run: () => Promise<{ result?: OrchestrationDiagnosticEntry['result']; detail?: any; output?: TOutput } | void>
): Promise<TOutput | void> {
  const baseEntry = buildOrchBase(base);
  logger({ ...baseEntry, detail: { ...detail, action: 'start' }, phase: 'tool' });
  try {
    const out = await run();
    const result = (out as any)?.result ?? null;
    const extraDetail = (out as any)?.detail;
    const output = (out as any)?.output as TOutput | undefined;
    logger({
      ...baseEntry,
      detail: { ...detail, ...(extraDetail || {}), action: 'success' },
      result,
      phase: 'tool',
    });
    return output as any;
  } catch (e: any) {
    logger({
      ...baseEntry,
      detail: { ...detail, action: 'error' },
      result: null,
      error: normalizeError(e),
      phase: 'tool',
    });
    throw e;
  }
}

/** Supported workspace operation kinds. */
export type WorkspaceOp = 'add_item' | 'list_items' | 'get_item' | 'update_item' | 'remove_item';

/**
 * Execute a workspace operation with diagnostic logging. Appends a tool message via the provided callback.
 */
export async function runWorkspaceOp<TOut = any>(
  logger: OrchLogger,
  base: OrchBaseInput,
  ctx: { conversations: ConversationThread[]; dirThreadId: string; conversationsFilePath: string },
  appendToolMessage: (payload: any) => void,
  op: WorkspaceOp,
  args: any,
  perform: (api: {
    newId: () => string;
    nowIso: () => string;
    resolve: () => { index: number; thread: ConversationThread };
    get: (thread: ConversationThread) => WorkspaceItem[];
    set: (index: number, items: WorkspaceItem[]) => Promise<void>;
  }) => Promise<TOut>
): Promise<TOut> {
  const { conversations, dirThreadId, conversationsFilePath } = ctx;
  const runApi = {
    newId,
    nowIso: () => new Date().toISOString(),
    resolve: () => resolveDirThread(conversations, dirThreadId),
    get: (thread: ConversationThread) => getWorkspace(thread),
    set: (index: number, items: WorkspaceItem[]) => setWorkspace(conversations, index, items, conversationsFilePath),
  };

  const output = await withOrchToolLogging<TOut>(
    logger,
    base,
    { tool: 'workspace', op, request: args },
    async () => {
      const out = await perform(runApi);
      appendToolMessage(out);
      return {
        result: {
          content: JSON.stringify(out),
          attachments: [],
          notifications: [],
          toolCallResult: { kind: 'workspace', op, success: true, result: out } as any,
        },
        output: out,
      };
    }
  );
  return output as TOut;
}
