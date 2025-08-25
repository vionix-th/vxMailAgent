import express from 'express';
import { FetcherLogEntry, CleanupStats } from '../../shared/types';
import { createCleanupService, RepositoryHub } from '../services/cleanup';

export interface CleanupRoutesDeps {
  getFetcherLog: () => FetcherLogEntry[];
  setFetcherLog: (next: FetcherLogEntry[]) => void;
  getOrchestrationLog: () => any[];
  setOrchestrationLog: (next: any[]) => void;
  getConversations: () => any[];
  setConversations: (next: any[]) => void;
  getProviderEvents: () => any[];
  setProviderEvents: (next: any[]) => void;
  getTraces: () => any[];
  setTraces: (next: any[]) => void;
}

export default function registerCleanupRoutes(app: express.Express, deps: CleanupRoutesDeps) {
  const router = express.Router();
  const hub: RepositoryHub = {
    getFetcherLog: () => deps.getFetcherLog(),
    setFetcherLog: (next: FetcherLogEntry[]) => deps.setFetcherLog(next),
    getOrchestrationLog: () => deps.getOrchestrationLog(),
    setOrchestrationLog: (next: any[]) => deps.setOrchestrationLog(next),
    getConversations: () => deps.getConversations(),
    setConversations: (next: any[]) => deps.setConversations(next),
    getProviderEvents: () => deps.getProviderEvents(),
    setProviderEvents: (next: any[]) => deps.setProviderEvents(next),
    getTraces: () => deps.getTraces(),
    setTraces: (next: any[]) => deps.setTraces(next),
  };
  const svc = createCleanupService(hub);

  router.get('/cleanup/stats', (_req, res) => {
    try {
      const stats: CleanupStats = svc.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get cleanup stats' });
    }
  });

  router.delete('/cleanup/all', (_req, res) => {
    try {
      const { deleted, message } = svc.purgeAll();
      res.json({ success: true, message, deleted });
    } catch (error) {
      res.status(500).json({ error: 'Failed to purge all logs' });
    }
  });

  router.delete('/cleanup/fetcher-logs', (_req, res) => {
    try {
      const result = svc.purge('fetcher');
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete fetcher logs' });
    }
  });

  router.delete('/cleanup/orchestration-logs', (_req, res) => {
    try {
      const result = svc.purge('orchestration');
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete orchestration logs' });
    }
  });

  router.delete('/cleanup/conversations', (_req, res) => {
    try {
      const result = svc.purge('conversations');
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete conversations' });
    }
  });

  router.delete('/cleanup/provider-events', (_req, res) => {
    try {
      const result = svc.purge('providerEvents');
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete provider events' });
    }
  });

  router.delete('/cleanup/traces', (_req, res) => {
    try {
      const result = svc.purge('traces');
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete traces' });
    }
  });

  app.use('/api', router);
}
