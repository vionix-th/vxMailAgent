import express from 'express';
import { errorHandler, ValidationError } from '../services/error-handler';
import { LiveRepos } from '../liveRepos';
import { EmailEnvelope, ConversationThread, ProviderEvent, OrchestrationEvent } from '../../shared/types';
import { requireContext, ContextInput } from '../utils/repo-access';

interface EmailWithConversations extends EmailEnvelope {
  conversations: ConversationSummary[];
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  metrics: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalLatencyMs: number;
    requestCount: number;
    errorCount: number;
    toolCallCount: number;
  };
}

interface ConversationSummary {
  id: string;
  kind: 'director' | 'agent';
  status: 'ongoing' | 'completed' | 'failed';
  directorId: string;
  agentId?: string;
  messageCount: number;
  tokenUsage: number;
  lastActiveAt: string;
}

export function createEmailRoutes(repos: LiveRepos): express.Router {
  const router = express.Router();

  // GET /api/emails - Enhanced email list with conversation summaries
  router.get('/', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const statusRaw = (req.query.status ?? 'all') as string;

    const limitStr = typeof limitRaw === 'string' ? limitRaw : undefined;
    const offsetStr = typeof offsetRaw === 'string' ? offsetRaw : undefined;

    if (limitStr && !/^\d+$/.test(limitStr)) {
      throw new ValidationError('limit must be an integer between 1 and 100');
    }
    if (offsetStr && !/^\d+$/.test(offsetStr)) {
      throw new ValidationError('offset must be a non-negative integer');
    }

    const limit = limitStr ? Number(limitStr) : 50;
    const offset = offsetStr ? Number(offsetStr) : 0;
    if (!(limit >= 1 && limit <= 100)) {
      throw new ValidationError('limit must be between 1 and 100');
    }
    if (offset < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }

    const status = statusRaw ? statusRaw.toLowerCase() : 'all';
    const allowedStatuses = new Set(['all', 'pending', 'processing', 'completed', 'failed']);
    if (!allowedStatuses.has(status)) {
      throw new ValidationError('status filter is invalid');
    }

    const context = requireContext(req);
    const chunkSize = Math.max(limit, 50);
    let cursor = 0;
    let totalEmails = 0;
    let totalMatching = 0;
    const paginated: EmailWithConversations[] = [];

    while (true) {
      const page = await repos.getEmailsPage(context, { offset: cursor, limit: chunkSize, totalHint: totalEmails || undefined });
      if (cursor === 0) {
        totalEmails = page.total;
      }
      const items = page.items as EmailEnvelope[];
      if (!items.length) break;

      const summaries = await buildEmailSummaries(repos, context, items);
      for (const email of items) {
        const summary = summaries.get(email.id);
        if (!summary) continue;
        if (!statusMatches(summary.processingStatus, status as StatusFilter)) {
          continue;
        }
        totalMatching += 1;
        if (totalMatching > offset && paginated.length < limit) {
          paginated.push(summary);
        }
      }

      cursor += items.length;
      if (cursor >= totalEmails) {
        break;
      }
    }

    res.json({
      emails: paginated,
      total: totalMatching,
      limit,
      offset,
    });
  }));

  router.delete('/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const emailId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!emailId) {
      throw new ValidationError('Email id is required for deletion');
    }
    const context = requireContext(req);
    const deleted = await repos.deleteEmail(context, emailId);
    if (!deleted) {
      res.status(404).json({ success: false, message: `Email ${emailId} not found` });
      return;
    }
    res.json({ success: true, deleted: { id: emailId } });
  }));

  return router;
}

type ProcessingStatus = EmailWithConversations['processingStatus'];
type StatusFilter = 'all' | ProcessingStatus;

function statusMatches(current: ProcessingStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return current === filter;
}

async function buildEmailSummaries(
  repos: LiveRepos,
  context: ContextInput,
  emails: EmailEnvelope[]
): Promise<Map<string, EmailWithConversations>> {
  const map = new Map<string, EmailWithConversations>();
  if (!emails.length) {
    return map;
  }

  const emailIds = emails.map((email) => email.id);
  const threads = await repos.getConversationsByEmailIds(context, emailIds);
  const threadsByEmail = groupConversationsByEmail(threads);

  const conversationIds = threads.map((thread) => thread.id);
  const providerEvents = conversationIds.length
    ? await repos.getProviderEventsByConversationIds(context, conversationIds)
    : [];
  const providerByConversation = groupProviderEvents(providerEvents);

  const orchestrationEvents = conversationIds.length
    ? await repos.getOrchestrationLogByConversationIds(context, conversationIds)
    : [];
  const orchestrationByConversation = groupOrchestrationEvents(orchestrationEvents);

  for (const email of emails) {
    const threadsForEmail = threadsByEmail.get(email.id) ?? [];
    const processingStatus = determineProcessingStatus(threadsForEmail);

    const conversationSummaries: ConversationSummary[] = threadsForEmail.map((thread) => {
      const provider = providerByConversation.get(thread.id) ?? [];
      return {
        id: thread.id,
        kind: thread.kind,
        status: thread.status,
        directorId: thread.directorId,
        ...(thread.kind === 'agent' ? { agentId: thread.agentId } : {}),
        messageCount: Array.isArray(thread.messages) ? thread.messages.length : 0,
        tokenUsage: provider.reduce((sum, event) => sum + (event.usage?.totalTokens || 0), 0),
        lastActiveAt: thread.lastActiveAt,
      };
    });

    const providerForEmail = threadsForEmail.flatMap((thread) => providerByConversation.get(thread.id) ?? []);
    const orchestrationForEmail = threadsForEmail.flatMap((thread) => orchestrationByConversation.get(thread.id) ?? []);
    const toolCallCount = threadsForEmail.reduce((outer, thread) => {
      if (!Array.isArray(thread.messages)) return outer;
      return outer + thread.messages.reduce((inner, message: any) => {
        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;
        return inner + toolCalls;
      }, 0);
    }, 0);

    const metrics = {
      totalTokens: providerForEmail.reduce((sum, event) => sum + (event.usage?.totalTokens || 0), 0),
      promptTokens: providerForEmail.reduce((sum, event) => sum + (event.usage?.promptTokens || 0), 0),
      completionTokens: providerForEmail.reduce((sum, event) => sum + (event.usage?.completionTokens || 0), 0),
      totalLatencyMs: providerForEmail.reduce((sum, event) => sum + (event.latencyMs || 0), 0),
      requestCount: providerForEmail.filter((event) => event.type === 'request').length,
      errorCount: orchestrationForEmail.filter((event) => !(event as any)?.outcome?.success).length,
      toolCallCount,
    };

    map.set(email.id, {
      ...email,
      conversations: conversationSummaries,
      processingStatus,
      metrics,
    });
  }

  return map;
}

function groupConversationsByEmail(conversations: ConversationThread[]): Map<string, ConversationThread[]> {
  const grouped = new Map<string, ConversationThread[]>();
  for (const conversation of conversations) {
    const emailId = (conversation.email as any)?.id;
    if (typeof emailId !== 'string' || emailId.length === 0) {
      continue;
    }
    const list = grouped.get(emailId) ?? [];
    list.push(conversation);
    grouped.set(emailId, list);
  }
  return grouped;
}

function groupProviderEvents(events: ProviderEvent[]): Map<string, ProviderEvent[]> {
  const grouped = new Map<string, ProviderEvent[]>();
  for (const event of events) {
    const list = grouped.get(event.conversationId) ?? [];
    list.push(event);
    grouped.set(event.conversationId, list);
  }
  return grouped;
}

function groupOrchestrationEvents(events: OrchestrationEvent[]): Map<string, OrchestrationEvent[]> {
  const grouped = new Map<string, OrchestrationEvent[]>();
  for (const event of events) {
    const conversationId = (event.context as any)?.conversationId ?? (event as any)?.conversationId;
    if (typeof conversationId !== 'string') continue;
    const list = grouped.get(conversationId) ?? [];
    list.push(event);
    grouped.set(conversationId, list);
  }
  return grouped;
}

function determineProcessingStatus(threads: ConversationThread[]): ProcessingStatus {
  if (!threads.length) {
    return 'pending';
  }
  if (threads.some((thread) => thread.status === 'ongoing')) {
    return 'processing';
  }
  if (threads.some((thread) => thread.status === 'failed')) {
    return 'failed';
  }
  if (threads.every((thread) => thread.status === 'completed')) {
    return 'completed';
  }
  return 'pending';
}
