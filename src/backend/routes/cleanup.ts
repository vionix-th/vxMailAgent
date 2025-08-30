import express from 'express';
import { createCleanupService, RepositoryHub } from '../services/cleanup';
import { UserRequest, getUserContext } from '../middleware/user-context';

export default function registerCleanupRoutes(app: express.Express) {
  function makeCleanup(req: UserRequest) {
    const { repos } = getUserContext(req);
    const hub: RepositoryHub = {
      getConversations: () => repos.conversations.getAll(),
      setConversations: (next: any[]) => repos.conversations.setAll(next),
      getOrchestrationLog: () => repos.orchestrationLog.getAll(),
      setOrchestrationLog: (next: any[]) => repos.orchestrationLog.setAll(next),
      getProviderEvents: () => repos.providerEvents.getAll(),
      setProviderEvents: (next: any[]) => repos.providerEvents.setAll(next),
      getTraces: () => repos.traces.getAll(),
      setTraces: (next: any[]) => repos.traces.setAll(next),
      getFetcherLog: () => repos.fetcherLog.getAll(),
      setFetcherLog: (next: any[]) => repos.fetcherLog.setAll(next),
      getWorkspaceItems: () => repos.workspaceItems.getAll(),
      setWorkspaceItems: (next: any[]) => repos.workspaceItems.setAll(next),
    };
    return createCleanupService(hub);
  }

  // Stats for current user (used by frontend settings)
  app.get('/api/cleanup/stats', (req, res) => {
    try {
      const cleanup = makeCleanup(req as UserRequest);
      const stats = cleanup.getStats();
      res.json(stats);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Purge all logs and data for the current user (frontend expects /api/cleanup/all)
  app.delete('/api/cleanup/all', (req, res) => {
    try {
      const cleanup = makeCleanup(req as UserRequest);
      const { deleted, message } = cleanup.purgeAll();
      res.json({ success: true, deleted, message });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Individual purge endpoints expected by frontend
  app.delete('/api/cleanup/fetcher-logs', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('fetcher'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/orchestration-logs', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('orchestration'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/conversations', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('conversations'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/workspace-items', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('workspaceItems'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/provider-events', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('providerEvents'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/traces', (req, res) => {
    try { const out = makeCleanup(req as UserRequest).purge('traces'); res.json({ success: true, ...out }); }
    catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
}
