import { OrchestrationEvent, OrchestrationContext, OrchestrationOutcome, EmailEnvelope, ConversationThread } from '../../shared/types';
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
  emailId: string;
  accountId?: string;
  email?: EmailEnvelope;
  fetchCycleId: string;
  dirThreadId?: string;
  agentThreadId?: string;
};

/**
 * Build the fixed portion of an orchestration event.
 * Consumers typically spread this into the final object and add { context, outcome, phase }.
 */
export function buildOrchBase(): Omit<OrchestrationEvent, 'context' | 'outcome' | 'phase'> {
  return {
    id: newId(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build orchestration context from base input.
 */
export function buildOrchContext(input: OrchBaseInput): OrchestrationContext {
  return {
    fetchCycleId: input.fetchCycleId || '',
    emailId: input.emailId,
    accountId: input.accountId,
    directorId: input.director,
    agentId: input.agent,
    conversationId: input.dirThreadId || input.agentThreadId,
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

/** Callback used to emit orchestration events. */
export type OrchLogger = (entry: OrchestrationEvent) => void;

/**
 * Run an async tool operation with standardized diagnostics for start/success/error.
 * The `run` callback may return `{ result, detail, output }`.
 */
export async function withOrchToolLogging<TOutput = any>(
  logger: OrchLogger,
  base: OrchBaseInput,
  detail: any,
  run: () => Promise<{ result?: OrchestrationOutcome['result']; detail?: any; output?: TOutput } | void>
): Promise<TOutput | void> {
  const baseEntry = buildOrchBase();
  const context = buildOrchContext(base);
  logger({ 
    ...baseEntry, 
    context,
    outcome: { success: true, metrics: { ...detail, action: 'start' } },
    phase: 'tool' 
  });
  try {
    const out = await run();
    const result = (out as any)?.result ?? null;
    const extraDetail = (out as any)?.detail;
    const output = (out as any)?.output as TOutput | undefined;
    logger({
      ...baseEntry,
      context,
      outcome: { 
        success: true, 
        result,
        metrics: { ...detail, ...extraDetail, action: 'success' }
      },
      phase: 'tool',
    });
    return output as any;
  } catch (e: any) {
    logger({
      ...baseEntry,
      context,
      outcome: { 
        success: false, 
        error: normalizeError(e, detail),
        metrics: { ...detail, action: 'error' }
      },
      phase: 'tool',
    });
    throw e;
  }
}
