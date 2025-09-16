import express from 'express';
import { errorHandler, NotFoundError } from '../services/error-handler';
import { LiveRepos } from '../liveRepos';
import { ConversationThread, OrchestrationEvent, ProviderEvent, WorkspaceItem, PromptMessage } from '../../shared/types';
import { repoGetAll, requireReq, ReqLike } from '../utils/repo-access';

// Align with design: extend the canonical ConversationThread type
type ConversationDetails = ConversationThread & {
  providerEvents: ProviderEvent[];
  orchestrationEvents: OrchestrationEvent[];
  workspaceItems: WorkspaceItem[];
  metrics: ConversationMetrics;
};

interface ConversationMetrics {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalLatencyMs: number;
  requestCount: number;
  errorCount: number;
  toolCallCount: number;
}

type ThreadWithContext = ConversationThread & {
  fullMessages: PromptMessage[];
  toolCalls: ToolCallTrace[];
  providerEvents: ProviderEvent[];
};

interface ToolCallTrace {
  id: string;
  name: string;
  arguments: string;
  result?: any;
  error?: string;
  timestamp?: string;
  durationMs?: number;
}

export function createConversationsEnhancedRoutes(repos: LiveRepos): express.Router {
  const router = express.Router();

  // GET /api/conversations/:id/details - Get conversation with full context
  router.get('/:id/details', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const conversationId = req.params.id;
    
    const conversation = await repos.getConversationById(req as any, conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation ${conversationId} not found`);
    }

    // Get related data
    const [orchestrationEvents, providerEvents, allWorkspaceItems] = await Promise.all([
      repos.getOrchestrationLog(req as any).then((events: any[]) => 
        events.filter((e: any) => e.context.conversationId === conversationId)
      ),
      repos.getProviderEvents(req as any).then((events: any[]) => 
        events.filter((e: any) => e.conversationId === conversationId)
      ),
      repoGetAll<WorkspaceItem>(requireReq(req as any as ReqLike), 'workspaceItems')
    ]);
    const workspaceItems = (allWorkspaceItems || []).filter((w: WorkspaceItem) => w?.provenance?.conversationId === conversationId);

    // Calculate metrics
    const metrics: ConversationMetrics = {
      totalTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.totalTokens || 0), 0),
      promptTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.promptTokens || 0), 0),
      completionTokens: providerEvents.reduce((sum: number, e: any) => sum + (e.usage?.completionTokens || 0), 0),
      totalLatencyMs: providerEvents.reduce((sum: number, e: any) => sum + (e.latencyMs || 0), 0),
      requestCount: providerEvents.filter((e: any) => e.type === 'request').length,
      errorCount: orchestrationEvents.filter((e: any) => !e.outcome.success).length,
      toolCallCount: conversation.messages.reduce((sum: number, msg: any) => 
        sum + (msg.tool_calls?.length || 0), 0
      ),
    };

    const details: ConversationDetails = {
      ...conversation,
      providerEvents,
      orchestrationEvents,
      workspaceItems,
      metrics,
    };

    res.json(details);
  }));

  // GET /api/conversations/:id/provider-events - Get provider events for conversation
  router.get('/:id/provider-events', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const conversationId = req.params.id;
    
    const providerEvents = await repos.getProviderEvents(req as any);
    const conversationEvents = providerEvents.filter((e: any) => e.conversationId === conversationId);
    
    res.json(conversationEvents);
  }));

  // GET /api/threads/:id/full - Get thread with complete context
  router.get('/threads/:id/full', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const threadId = req.params.id;
    
    const conversation = await repos.getConversationById(req as any, threadId);
    if (!conversation) {
      throw new NotFoundError(`Thread ${threadId} not found`);
    }

    // Get provider events for this thread
    const providerEvents = await repos.getProviderEvents(req as any);
    const threadProviderEvents = providerEvents.filter((e: any) => e.conversationId === threadId);

    // Extract tool calls from messages
    const toolCalls: ToolCallTrace[] = [];
    conversation.messages.forEach((msg: any) => {
      if (msg.tool_calls) {
        msg.tool_calls.forEach((tc: any) => {
          // Find corresponding tool result in subsequent messages
          const resultMsg = conversation.messages.find((m: any) => 
            m.role === 'tool' && m.tool_call_id === tc.id
          );

          // Safe-parse tool result JSON; do not fabricate timestamps
          let parsed: any | undefined = undefined;
          let parseError: string | undefined = undefined;
          if (resultMsg && typeof resultMsg.content === 'string' && resultMsg.content.trim()) {
            try {
              parsed = JSON.parse(resultMsg.content);
            } catch (e: any) {
              parseError = 'invalid_tool_result_json';
            }
          }

          const timestamp = (typeof msg?.context?.variables?.timestamp === 'string')
            ? msg.context.variables.timestamp
            : undefined;

          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
            ...(parsed !== undefined ? { result: parsed } : {}),
            ...(parseError ? { error: parseError } : {}),
            ...(timestamp ? { timestamp } : {}),
          });
        });
      }
    });

    const threadWithContext: ThreadWithContext = {
      ...conversation,
      fullMessages: conversation.messages,
      toolCalls,
      providerEvents: threadProviderEvents,
    };

    res.json(threadWithContext);
  }));

  return router;
}
