import { OrchestrationDiagnosticEntry, EmailEnvelope, ConversationThread, WorkspaceItem } from '../../shared/types';
import * as persistence from '../persistence';
import { newId } from './id';

// Minimal base input required to build an orchestration diagnostic envelope
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

// Build a consistent base for OrchestrationDiagnosticEntry
// Consumers can spread this and add { detail, result, error, phase } as needed
export function buildOrchBase(input: OrchBaseInput): Omit<OrchestrationDiagnosticEntry, 'detail' | 'result' | 'error' | 'phase'> {
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

// --- Conversation/workspace helpers ---
export function resolveDirThread(conversations: ConversationThread[], dirThreadId: string): { index: number; thread: ConversationThread } {
  const index = conversations.findIndex(c => c.id === dirThreadId);
  if (index === -1) throw new Error('director thread not found');
  return { index, thread: conversations[index] };
}

export function getWorkspace(thread: ConversationThread): WorkspaceItem[] {
  return thread.workspaceItems || [];
}

export function setWorkspace(
  conversations: ConversationThread[],
  index: number,
  items: WorkspaceItem[],
  conversationsFilePath: string
) {
  const current = conversations[index];
  conversations[index] = { ...current, workspaceItems: items } as ConversationThread;
  try {
    persistence.encryptAndPersist(conversations, conversationsFilePath);
  } catch {}
}

// Normalize any thrown error into a structured value suitable for diagnostics
export function normalizeError(e: any, detail?: any) {
  const asAny = e as any;
  return {
    message: String(asAny?.message || asAny),
    stack: asAny?.stack,
    detail,
  };
}

// A thin logger interface to decouple from concrete logOrch implementation
export type OrchLogger = (entry: OrchestrationDiagnosticEntry) => void;

// Wrap a tool operation with standardized diagnostics logging for start/success/error.
// The `run` function should return an object with an optional `result` to be assigned to the
// diagnostics entry, and optional `detail` that will be merged into the success detail payload.
export async function withOrchToolLogging<TOutput = any>(
  logger: OrchLogger,
  base: OrchBaseInput,
  detail: any,
  run: () => Promise<{ result?: OrchestrationDiagnosticEntry['result']; detail?: any; output?: TOutput } | void>
): Promise<TOutput | void> {
  const baseEntry = buildOrchBase(base);
  // Start
  logger({ ...baseEntry, detail: { ...detail, action: 'start' }, phase: 'tool' });
  try {
    const out = await run();
    const result = (out as any)?.result ?? null;
    const extraDetail = (out as any)?.detail;
    const output = (out as any)?.output as TOutput | undefined;
    // Success
    logger({
      ...baseEntry,
      detail: { ...detail, ...(extraDetail || {}), action: 'success' },
      result,
      phase: 'tool',
    });
    return output as any;
  } catch (e: any) {
    // Error
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

// Unified workspace operation wrapper to DRY agent/director branches
export type WorkspaceOp = 'add_item' | 'list_items' | 'get_item' | 'update_item' | 'remove_item';

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
    set: (index: number, items: WorkspaceItem[]) => void;
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
      // Stream the tool message back to the transcript with the raw object
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
