import { OrchestrationDiagnosticEntry, EmailEnvelope, ConversationThread } from '../../shared/types';

/**
 * Minimal base input used to construct an orchestration diagnostic entry.
 */
export type OrchBaseInput = {
  director: string;
  directorName?: string;
  agent?: string;
  agentName?: string;
  emailSummary: string;
  emailId: string;
  accountId?: string;
  email?: EmailEnvelope;
  fetchCycleId: string;
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
    emailId: input.emailId,
    ...(input.directorName ? { directorName: input.directorName } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.agentName ? { agentName: input.agentName } : {}),
    emailSummary: input.emailSummary,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.email ? { email: input.email } : {}),
    fetchCycleId: input.fetchCycleId,
    ...(input.dirThreadId ? { dirThreadId: input.dirThreadId } : {}),
    ...(input.agentThreadId ? { agentThreadId: input.agentThreadId } : {}),
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
