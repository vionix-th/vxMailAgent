import express from 'express';
import {
  requireReq,
  getWorkspaceItemsRepo,
  getProviderEventsRepo,
  getTracesRepo,
  getOrchestrationLogRepo,
  ReqLike
} from '../utils/repo-access';
import { LiveRepos } from '../liveRepos';
import { errorHandler } from '../services/error-handler';
import type { WorkspaceItemsRepoInstance } from '../repository/wrappers';
import type { WorkspaceItem } from '../../shared/types';

async function purgeWorkspaceItems(repo: WorkspaceItemsRepoInstance): Promise<number> {
  const items = await repo.list();
  const list: WorkspaceItem[] = Array.isArray(items) ? items.slice() : Array.from(items);
  let deleted = 0;
  const conversationIds = new Set<string>();

  for (const item of list) {
    const cidRaw = item.provenance?.conversationId;
    const cid = typeof cidRaw === 'string' && cidRaw.trim().length > 0 ? cidRaw.trim() : null;
    if (cid) {
      conversationIds.add(cid);
    } else {
      if (await repo.delete(item.id)) {
        deleted += 1;
      }
    }
  }

  for (const cid of conversationIds) {
    deleted += await repo.deleteByConversation(cid);
  }

  return deleted;
}

async function purgeConversations(repos: LiveRepos, req: ReqLike): Promise<number> {
  const threads = await repos.getConversations(req);
  let deleted = 0;
  for (const thread of threads) {
    if (await repos.deleteConversation(req, thread.id)) {
      deleted += 1;
    }
  }
  return deleted;
}

export default function registerCleanupRoutes(
  app: express.Express,
  repos: LiveRepos,
  services: {
    getFetcherManager: (req: ReqLike) => {
      getFetcherLog: () => Promise<any[]>;
      setFetcherLog: (next: any[]) => Promise<void>;
      clearFetcherLog: () => Promise<void>;
    } | null;
  }
) {

  // Stats for current user (used by frontend settings)
  app.get('/api/cleanup/stats', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    
    // Get fetcher log from active fetcher manager, not repository
    const fetcherManager = services.getFetcherManager(ureq);
    const fetcherLog = fetcherManager ? await fetcherManager.getFetcherLog() : [];
    
    const [
      conversations,
      orchestrationLog,
      providerEvents,
      traces,
      workspaceItems,
    ] = await Promise.all([
      repos.getConversations(ureq),
      repos.getOrchestrationLog(ureq),
      getProviderEventsRepo(ureq).list(),
      getTracesRepo(ureq).list(),
      getWorkspaceItemsRepo(ureq).list(),
    ]);
    const stats = {
      fetcherLogs: fetcherLog.length,
      orchestrationLogs: orchestrationLog.length,
      conversations: conversations.length,
      workspaceItems: workspaceItems.length,
      providerEvents: providerEvents.length,
      traces: traces.length,
    };
    res.json({ ...stats, total: stats.fetcherLogs + stats.orchestrationLogs + stats.conversations + stats.workspaceItems + stats.providerEvents + stats.traces });
  }));

  // Purge all logs and data for the current user (frontend expects /api/cleanup/all)
  app.delete('/api/cleanup/all', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    
    // Get current counts before deletion
    const fetcherManager = services.getFetcherManager(ureq);
    const fetcherLog = fetcherManager ? await fetcherManager.getFetcherLog() : [];
    
    const [
      conversations,
      orchestrationLog,
      providerEvents,
      traces,
    ] = await Promise.all([
      repos.getConversations(ureq),
      repos.getOrchestrationLog(ureq),
      getProviderEventsRepo(ureq).list(),
      getTracesRepo(ureq).list(),
    ]);
    const workspaceRepo = getWorkspaceItemsRepo(ureq);
    const workspaceDeleted = await purgeWorkspaceItems(workspaceRepo);
    
    // Clear fetcher log through manager
    if (fetcherManager) {
      await fetcherManager.clearFetcherLog();
    }
    
    const conversationsDeleted = await purgeConversations(repos, ureq);
    await Promise.all([
      getOrchestrationLogRepo(ureq).clear(),
      getProviderEventsRepo(ureq).clear(),
      getTracesRepo(ureq).clear(),
    ]);
    const deleted = {
      fetcherLogs: fetcherLog.length,
      orchestrationLogs: orchestrationLog.length,
      conversations: conversationsDeleted,
      workspaceItems: workspaceDeleted,
      providerEvents: providerEvents.length,
      traces: traces.length,
    };
    res.json({
      success: true,
      deleted: { ...deleted, total: deleted.fetcherLogs + deleted.orchestrationLogs + deleted.conversations + deleted.workspaceItems + deleted.providerEvents + deleted.traces },
      message: 'Purged all user data and logs',
    });
  }));

  // Individual purge endpoints expected by frontend
  app.delete('/api/cleanup/fetcher-logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const fetcherManager = services.getFetcherManager(ureq);
    const prev = fetcherManager ? await fetcherManager.getFetcherLog() : [];
    if (fetcherManager) {
      await fetcherManager.clearFetcherLog();
    }
    res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} fetcher logs` });
  }));
  app.delete('/api/cleanup/orchestration-logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const prev = await repos.getOrchestrationLog(ureq);
    await getOrchestrationLogRepo(ureq).clear();
    res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} orchestration logs` });
  }));
  app.delete('/api/cleanup/conversations', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const deleted = await purgeConversations(repos, ureq);
    res.json({ success: true, deleted, message: `Deleted ${deleted} conversations` });
  }));
  app.delete('/api/cleanup/workspace-items', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const workspaceRepo = getWorkspaceItemsRepo(ureq);
    const deleted = await purgeWorkspaceItems(workspaceRepo);
    res.json({ success: true, deleted, message: `Deleted ${deleted} workspace items` });
  }));
  app.delete('/api/cleanup/provider-events', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const repo = getProviderEventsRepo(ureq);
    const prev = await repo.list();
    await repo.clear();
    res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} provider events` });
  }));
  app.delete('/api/cleanup/traces', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const repo = getTracesRepo(ureq);
    const prev = await repo.list();
    await repo.clear();
    res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} traces` });
  }));
}
