import express from 'express';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import { LiveRepos } from '../liveRepos';

export default function registerCleanupRoutes(
  app: express.Express,
  repos: LiveRepos,
  services: {
    getFetcherManager: (req: ReqLike) => { getFetcherLog: () => Promise<any[]>; setFetcherLog: (next: any[]) => Promise<void> } | null;
  }
) {

  // Stats for current user (used by frontend settings)
  app.get('/api/cleanup/stats', async (req, res) => {
    try {
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
        repoGetAll<any>(ureq, 'providerEvents'),
        repoGetAll<any>(ureq, 'traces'),
        repoGetAll<any>(ureq, 'workspaceItems'),
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
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Purge all logs and data for the current user (frontend expects /api/cleanup/all)
  app.delete('/api/cleanup/all', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      
      // Get current counts before deletion
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
        repoGetAll<any>(ureq, 'providerEvents'),
        repoGetAll<any>(ureq, 'traces'),
        repoGetAll<any>(ureq, 'workspaceItems'),
      ]);
      
      // Clear fetcher log through manager
      if (fetcherManager) {
        await fetcherManager.setFetcherLog([]);
      }
      
      await Promise.all([
        repos.setConversations(ureq, []),
        repoSetAll<any>(ureq, 'orchestrationLog', []),
        repoSetAll<any>(ureq, 'providerEvents', []),
        repoSetAll<any>(ureq, 'traces', []),
        repoSetAll<any>(ureq, 'workspaceItems', []),
      ]);
      const deleted = {
        fetcherLogs: fetcherLog.length,
        orchestrationLogs: orchestrationLog.length,
        conversations: conversations.length,
        workspaceItems: workspaceItems.length,
        providerEvents: providerEvents.length,
        traces: traces.length,
      };
      res.json({
        success: true,
        deleted: { ...deleted, total: deleted.fetcherLogs + deleted.orchestrationLogs + deleted.conversations + deleted.workspaceItems + deleted.providerEvents + deleted.traces },
        message: 'Purged all user data and logs',
      });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Individual purge endpoints expected by frontend
  app.delete('/api/cleanup/fetcher-logs', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const fetcherManager = services.getFetcherManager(ureq);
      const prev = fetcherManager ? await fetcherManager.getFetcherLog() : [];
      if (fetcherManager) {
        await fetcherManager.setFetcherLog([]);
      }
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} fetcher logs` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/orchestration-logs', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repos.getOrchestrationLog(ureq);
      await repoSetAll<any>(ureq, 'orchestrationLog', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} orchestration logs` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/conversations', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repos.getConversations(ureq);
      await repos.setConversations(ureq, []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} conversations` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/workspace-items', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repoGetAll<any>(ureq, 'workspaceItems');
      await repoSetAll<any>(ureq, 'workspaceItems', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} workspace items` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/provider-events', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repoGetAll<any>(ureq, 'providerEvents');
      await repoSetAll<any>(ureq, 'providerEvents', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} provider events` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/traces', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repoGetAll<any>(ureq, 'traces');
      await repoSetAll<any>(ureq, 'traces', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} traces` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
}

