import express from 'express';
import { errorHandler } from '../services/error-handler';
import { LiveRepos } from '../liveRepos';
import { EmailEnvelope } from '../../shared/types';

interface EmailWithConversations extends EmailEnvelope {
  conversations: ConversationSummary[];
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  metrics: {
    totalTokens: number;
    totalLatencyMs: number;
    errorCount: number;
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
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const status = req.query.status as string;

    // Get all emails (would need pagination in real implementation)
    const allEmails = await repos.getEmails(req as any);
    
    // Get conversations and orchestration events for correlation
    const conversations = await repos.getConversations(req as any);
    const orchestrationEvents = await repos.getOrchestrationLog(req as any);
    const providerEvents = await repos.getProviderEvents(req as any);

    // Build enhanced email data
    const emailsWithConversations: EmailWithConversations[] = allEmails.map((email: any) => {
      const emailConversations = conversations.filter(c => c.email.id === email.id);
      const emailEvents = orchestrationEvents.filter(e => e.context.emailId === email.id);
      const emailProviderEvents = providerEvents.filter((e: any) => 
        emailConversations.some((c: any) => c.id === e.conversationId)
      );

      // Calculate metrics
      const totalTokens = emailProviderEvents.reduce((sum: number, e: any) => 
        sum + (e.usage?.totalTokens || 0), 0
      );
      const totalLatencyMs = emailProviderEvents.reduce((sum: number, e: any) => 
        sum + (e.latencyMs || 0), 0
      );
      const errorCount = emailEvents.filter((e: any) => !e.outcome.success).length;

      // Determine processing status
      let processingStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending';
      if (emailConversations.length > 0) {
        const hasOngoing = emailConversations.some(c => c.status === 'ongoing');
        const hasFailed = emailConversations.some(c => c.status === 'failed');
        const allCompleted = emailConversations.every(c => c.status === 'completed');
        
        if (hasOngoing) processingStatus = 'processing';
        else if (hasFailed) processingStatus = 'failed';
        else if (allCompleted) processingStatus = 'completed';
      }

      // Build conversation summaries
      const conversationSummaries: ConversationSummary[] = emailConversations.map(c => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        directorId: c.directorId,
        ...(c.kind === 'agent' ? { agentId: c.agentId } : {}),
        messageCount: c.messages.length,
        tokenUsage: emailProviderEvents
          .filter((e: any) => e.conversationId === c.id)
          .reduce((sum: number, e: any) => sum + (e.usage?.totalTokens || 0), 0),
        lastActiveAt: c.lastActiveAt,
      }));

      return {
        ...email,
        conversations: conversationSummaries,
        processingStatus,
        metrics: {
          totalTokens,
          totalLatencyMs,
          errorCount,
        },
      };
    });

    // Apply status filter if specified
    const filteredEmails = status && status !== 'all' 
      ? emailsWithConversations.filter(e => e.processingStatus === status)
      : emailsWithConversations;

    // Apply pagination
    const total = filteredEmails.length;
    const paginatedEmails = filteredEmails.slice(offset, offset + limit);

    res.json({
      emails: paginatedEmails,
      total,
      limit,
      offset,
    });
  }));

  return router;
}
