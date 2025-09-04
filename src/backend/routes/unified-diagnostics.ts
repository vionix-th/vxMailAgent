import express from 'express';
import { OrchestrationDiagnosticEntry, ConversationThread, ProviderEvent, Trace } from '../../shared/types';
import { ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

import { LiveRepos } from '../liveRepos';

// Unified diagnostic tree structure
export interface DiagnosticNode {
  id: string;
  type: 'fetchCycle' | 'account' | 'email' | 'director' | 'agent' | 'conversation' | 'providerEvent';
  name: string;
  timestamp?: string;
  status?: 'success' | 'error' | 'pending';
  metadata?: any;
  children?: DiagnosticNode[];
  // Raw data for detail view
  orchestrationEntry?: OrchestrationDiagnosticEntry;
  conversation?: ConversationThread;
  providerEvent?: ProviderEvent;
  trace?: Trace;
}

export interface UnifiedDiagnosticsResponse {
  tree: DiagnosticNode[];
  summary: {
    totalFetchCycles: number;
    totalEmails: number;
    totalDirectors: number;
    totalAgents: number;
    totalConversations: number;
    totalProviderEvents: number;
    totalErrors: number;
  };
}

function buildHierarchicalTree(
  orchestrationEntries: OrchestrationDiagnosticEntry[],
  conversations: ConversationThread[],
  providerEvents: ProviderEvent[],
  _traces: Trace[]
): DiagnosticNode[] {
  // Group by fetch cycle -> email -> director conversations -> agent conversations
  const fetchCycles = new Map<string, {
    id: string;
    timestamp: string;
    emails: Map<string, {
      id: string;
      subject: string;
      directorConversations: Map<string, {
        conversation: ConversationThread;
        directorName: string;
        agentConversations: ConversationThread[];
        providerEvents: ProviderEvent[];
        orchestrationEntries: OrchestrationDiagnosticEntry[];
      }>;
    }>;
  }>();

  // Process orchestration entries to understand email processing
  for (const entry of orchestrationEntries) {
    const cycleId = entry.fetchCycleId || 'unknown';
    const emailId = (entry.email as any)?.id || 'unknown';
    const directorId = entry.director;

    if (!fetchCycles.has(cycleId)) {
      fetchCycles.set(cycleId, {
        id: cycleId,
        timestamp: entry.timestamp,
        emails: new Map()
      });
    }

    const cycle = fetchCycles.get(cycleId)!;
    if (!cycle.emails.has(emailId)) {
      cycle.emails.set(emailId, {
        id: emailId,
        subject: (entry.email as any)?.subject || 'Unknown Subject',
        directorConversations: new Map()
      });
    }

    const email = cycle.emails.get(emailId)!;

    // Associate director conversation with this email
    if (directorId && entry.dirThreadId) {
      if (!email.directorConversations.has(entry.dirThreadId)) {
        email.directorConversations.set(entry.dirThreadId, {
          conversation: {} as ConversationThread, // Will be filled later
          directorName: directorId,
          agentConversations: [],
          providerEvents: [],
          orchestrationEntries: []
        });
      }
      
      email.directorConversations.get(entry.dirThreadId)!.orchestrationEntries.push(entry);
    }
  }

  // Associate conversations with their proper locations
  for (const conversation of conversations) {
    const conversationId = conversation.id;
    const parentId = conversation.parentId;

    for (const cycle of fetchCycles.values()) {
      for (const email of cycle.emails.values()) {
        // Director conversation (no parentId)
        if (conversation.kind === 'director' && !parentId) {
          for (const [dirThreadId, dirConv] of email.directorConversations) {
            if (conversationId === dirThreadId) {
              dirConv.conversation = conversation;
            }
          }
        }

        // Agent conversation (has parentId pointing to director)
        if (conversation.kind === 'agent' && parentId) {
          const dirConv = email.directorConversations.get(parentId);
          if (dirConv) {
            dirConv.agentConversations.push(conversation);
          }
        }
      }
    }
  }

  // Associate provider events with conversations
  for (const event of providerEvents) {
    const conversationId = event.conversationId;

    for (const cycle of fetchCycles.values()) {
      for (const email of cycle.emails.values()) {
        for (const dirConv of email.directorConversations.values()) {
          // Director conversation events
          if (dirConv.conversation.id === conversationId) {
            dirConv.providerEvents.push(event);
          }

          // Agent conversation events
          const agentConv = dirConv.agentConversations.find(c => c.id === conversationId);
          if (agentConv) {
            dirConv.providerEvents.push(event);
          }
        }
      }
    }
  }

  // Convert to tree structure
  const tree: DiagnosticNode[] = [];
  
  for (const [cycleId, cycle] of fetchCycles) {
    const cycleNode: DiagnosticNode = {
      id: cycleId,
      type: 'fetchCycle',
      name: `Fetch Cycle ${cycleId}`,
      timestamp: cycle.timestamp,
      children: [],
      metadata: {
        totalEmails: cycle.emails.size,
        totalDirectorConversations: Array.from(cycle.emails.values()).reduce((sum, e) => sum + e.directorConversations.size, 0),
        totalAgentConversations: Array.from(cycle.emails.values()).reduce((sum, e) => 
          sum + Array.from(e.directorConversations.values()).reduce((agentSum, d) => agentSum + d.agentConversations.length, 0), 0)
      }
    };

    for (const [emailId, email] of cycle.emails) {
      const emailNode: DiagnosticNode = {
        id: emailId,
        type: 'email',
        name: email.subject,
        timestamp: cycle.timestamp,
        children: [],
        metadata: {
          totalDirectorConversations: email.directorConversations.size,
          totalAgentConversations: Array.from(email.directorConversations.values()).reduce((sum, d) => sum + d.agentConversations.length, 0),
          subject: email.subject
        }
      };

      for (const [dirThreadId, dirConv] of email.directorConversations) {
        const directorNode: DiagnosticNode = {
          id: dirThreadId,
          type: 'director',
          name: `Director: ${dirConv.directorName}`,
          timestamp: dirConv.conversation.startedAt || cycle.timestamp,
          children: [],
          metadata: {
            directorName: dirConv.directorName,
            totalAgentConversations: dirConv.agentConversations.length,
            totalProviderEvents: dirConv.providerEvents.length,
            status: dirConv.conversation.status,
            messageCount: dirConv.conversation.messages?.length || 0,
            hasResult: !!dirConv.conversation.result
          },
          conversation: dirConv.conversation
        };

        // Add director's provider events
        for (const event of dirConv.providerEvents.filter(e => e.conversationId === dirConv.conversation.id)) {
          const eventNode: DiagnosticNode = {
            id: event.id,
            type: 'providerEvent',
            name: `${event.type.toUpperCase()} - ${event.provider}`,
            timestamp: event.timestamp,
            children: [],
            metadata: {
              type: event.type,
              provider: event.provider,
              usage: event.usage,
              latencyMs: event.latencyMs,
              hasError: !!event.error
            },
            providerEvent: event
          };
          directorNode.children!.push(eventNode);
        }

        // Add agent conversations as children of director
        for (const agentConv of dirConv.agentConversations) {
          const agentNode: DiagnosticNode = {
            id: agentConv.id,
            type: 'agent',
            name: `Agent: ${agentConv.agentId || 'Unknown'}`,
            timestamp: agentConv.startedAt,
            children: [],
            metadata: {
              agentId: agentConv.agentId,
              status: agentConv.status,
              messageCount: agentConv.messages?.length || 0,
              hasResult: !!agentConv.result,
              parentId: agentConv.parentId
            },
            conversation: agentConv
          };

          // Add agent's provider events
          for (const event of dirConv.providerEvents.filter(e => e.conversationId === agentConv.id)) {
            const eventNode: DiagnosticNode = {
              id: event.id,
              type: 'providerEvent',
              name: `${event.type.toUpperCase()} - ${event.provider}`,
              timestamp: event.timestamp,
              children: [],
              metadata: {
                type: event.type,
                provider: event.provider,
                usage: event.usage,
                latencyMs: event.latencyMs,
                hasError: !!event.error
              },
              providerEvent: event
            };
            agentNode.children!.push(eventNode);
          }

          directorNode.children!.push(agentNode);
        }

        emailNode.children!.push(directorNode);
      }

      cycleNode.children!.push(emailNode);
    }

    tree.push(cycleNode);
  }

  return tree;
}

export default function registerUnifiedDiagnosticsRoutes(
  app: express.Express, 
  repos: LiveRepos,
  services: {
    getTraces: (req?: ReqLike) => Promise<Trace[]>;
    getProviderEvents: (req?: ReqLike) => Promise<ProviderEvent[]>;
  }
) {
  // GET unified hierarchical diagnostics tree
  app.get('/api/diagnostics/unified', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const [orchestrationEntries, conversations, providerEvents, traces] = await Promise.all([
      repos.getOrchestrationLog(req as any as ReqLike),
      repos.getConversations(req as any as ReqLike),
      services.getProviderEvents(req as any as ReqLike),
      services.getTraces(req as any as ReqLike),
    ]);

    const tree = buildHierarchicalTree(orchestrationEntries, conversations, providerEvents, traces);

    // Calculate summary statistics
    const summary = {
      totalFetchCycles: tree.length,
      totalEmails: tree.reduce((sum, cycle) => 
        sum + (cycle.children?.reduce((emailSum, account) => 
          emailSum + (account.children?.length || 0), 0) || 0), 0),
      totalDirectors: orchestrationEntries.reduce((set, entry) => 
        set.add(entry.director), new Set()).size,
      totalAgents: orchestrationEntries.reduce((set, entry) => 
        set.add(entry.agent), new Set()).size,
      totalConversations: conversations.length,
      totalProviderEvents: providerEvents.length,
      totalErrors: orchestrationEntries.filter(e => e.error).length
    };

    const response: UnifiedDiagnosticsResponse = { tree, summary };
    res.json(response);
  }));

  // GET detailed view for specific node
  app.get('/api/diagnostics/unified/:nodeId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const nodeId = req.params.nodeId;
    const [nodeType, id] = nodeId.split('-', 2);

    let result: any = null;

    switch (nodeType) {
      case 'conv':
        result = (await repos.getConversations(req as any as ReqLike)).find((c: any) => c.id === id);
        break;
      case 'event':
        result = (await services.getProviderEvents(req as any as ReqLike)).find((e: any) => e.id === id);
        break;
      default:
        throw new ValidationError('Invalid node type');
    }

    if (!result) {
      throw new NotFoundError('Node not found');
    }

    res.json(result);
  }));
}
