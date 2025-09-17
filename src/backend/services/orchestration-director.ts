import { Filter } from '../../shared/types';
import logger from './logger';

export interface EmailContext {
  from: string;
  subject: string;
  to?: string;
  cc?: string;
  bcc?: string;
  bodyPlain?: string;
  bodyHtml?: string;
  snippet?: string;
  date?: string;
}

export interface FilterEvaluation {
  filter: Filter;
  match: boolean;
  fieldValue: string;
}

/** Evaluates filters against the provided email context. */
export function evaluateFilters(filters: Filter[], ctx: EmailContext): FilterEvaluation[] {
  return filters.map(f => {
    let match = false;
    let fieldValue = '';
    try {
      switch (f.field) {
        case 'from': fieldValue = ctx.from ?? ''; break;
        case 'to': fieldValue = ctx.to ?? ''; break;
        case 'cc': fieldValue = ctx.cc ?? ''; break;
        case 'bcc': fieldValue = ctx.bcc ?? ''; break;
        case 'subject': fieldValue = ctx.subject ?? ''; break;
        case 'body': fieldValue = (ctx.bodyPlain ?? '') + '\n' + (ctx.bodyHtml ?? '') + '\n' + (ctx.snippet ?? ''); break;
        case 'date': fieldValue = ctx.date ?? ''; break;
        default: fieldValue = '';
      }
      match = new RegExp(f.regex, 'i').test(fieldValue);
    } catch (e: any) {
      logger.warn('ORCHESTRATION evaluateFilters regex error', {
        error: e?.message || String(e),
        filterId: f.id,
        field: f.field,
        regex: f.regex,
      });
    }
    return { filter: f, match, fieldValue };
  });
}

/** Derive director ids that should trigger based on filter evaluations. */
export function selectDirectorTriggers(evals: FilterEvaluation[]): string[] {
  const directorTriggers: string[] = [];
  const nonDupSeen = new Set<string>();
  for (const e of evals) {
    if (!e.match) continue;
    const dirId = e.filter.directorId;
    if (e.filter.duplicateAllowed) directorTriggers.push(dirId);
    else if (!nonDupSeen.has(dirId)) { directorTriggers.push(dirId); nonDupSeen.add(dirId); }
  }
  return directorTriggers;
}

// Finalization removed; completion is implicit when loops end

/** Enhanced logging hook for conversation step diagnostics. */
export function logConversationStepDiagnostic(
  stepType: 'director_start' | 'director_llm' | 'director_tool' | 'director_finalize' | 'agent_start' | 'agent_llm' | 'agent_tool' | 'agent_finalize',
  conversationId: string,
  details: any,
  logOrch?: (e: any) => void
) {
  if (!logOrch) return;
  try {
    logOrch({
      timestamp: new Date().toISOString(),
      type: 'conversation_step_diagnostic',
      stepType,
      conversationId,
      details,
      level: 'debug'
    });
  } catch (e) {
    console.warn('Failed to log conversation step diagnostic:', e);
  }
}
