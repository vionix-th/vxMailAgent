import express from 'express';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';

export default function registerCleanupRoutes(app: express.Express) {

  // Stats for current user (used by frontend settings)
  app.get('/api/cleanup/stats', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const [
        conversations,
        orchestrationLog,
        providerEvents,
        traces,
        fetcherLog,
        workspaceItems,
      ] = await Promise.all([
        repoGetAll<any>(ureq, 'conversations'),
        repoGetAll<any>(ureq, 'orchestrationLog'),
        repoGetAll<any>(ureq, 'providerEvents'),
        repoGetAll<any>(ureq, 'traces'),
        repoGetAll<any>(ureq, 'fetcherLog'),
        repoGetAll<any>(ureq, 'workspaceItems'),
      ]);
      res.json({
        conversations: conversations.length,
        orchestrationLog: orchestrationLog.length,
        providerEvents: providerEvents.length,
        traces: traces.length,
        fetcherLog: fetcherLog.length,
        workspaceItems: workspaceItems.length,
      });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Purge all logs and data for the current user (frontend expects /api/cleanup/all)
  app.delete('/api/cleanup/all', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const [
        conversations,
        orchestrationLog,
        providerEvents,
        traces,
        fetcherLog,
        workspaceItems,
      ] = await Promise.all([
        repoGetAll<any>(ureq, 'conversations'),
        repoGetAll<any>(ureq, 'orchestrationLog'),
        repoGetAll<any>(ureq, 'providerEvents'),
        repoGetAll<any>(ureq, 'traces'),
        repoGetAll<any>(ureq, 'fetcherLog'),
        repoGetAll<any>(ureq, 'workspaceItems'),
      ]);
      await Promise.all([
        repoSetAll<any>(ureq, 'conversations', []),
        repoSetAll<any>(ureq, 'orchestrationLog', []),
        repoSetAll<any>(ureq, 'providerEvents', []),
        repoSetAll<any>(ureq, 'traces', []),
        repoSetAll<any>(ureq, 'fetcherLog', []),
        repoSetAll<any>(ureq, 'workspaceItems', []),
      ]);
      res.json({
        success: true,
        deleted: conversations.length + orchestrationLog.length + providerEvents.length + traces.length + fetcherLog.length + workspaceItems.length,
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
      const prev = await repoGetAll<any>(ureq, 'fetcherLog');
      await repoSetAll<any>(ureq, 'fetcherLog', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} fetcher logs` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/orchestration-logs', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repoGetAll<any>(ureq, 'orchestrationLog');
      await repoSetAll<any>(ureq, 'orchestrationLog', []);
      res.json({ success: true, deleted: prev.length, message: `Deleted ${prev.length} orchestration logs` });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.delete('/api/cleanup/conversations', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const prev = await repoGetAll<any>(ureq, 'conversations');
      await repoSetAll<any>(ureq, 'conversations', []);
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

