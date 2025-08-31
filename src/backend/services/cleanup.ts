import { CleanupStats } from '../../shared/types';
import logger from './logger';

/** Accessors for repositories used by the cleanup service. */
export interface RepositoryHub<TConv = any, TOrch = any, TProv = any, TTrace = any, TFetch = any> {
  getConversations: () => TConv[];
  setConversations: (next: TConv[]) => void;
  getOrchestrationLog: () => TOrch[];
  setOrchestrationLog: (next: TOrch[]) => void;
  getProviderEvents: () => TProv[];
  setProviderEvents: (next: TProv[]) => void;
  getTraces: () => TTrace[];
  setTraces: (next: TTrace[]) => void;
  getFetcherLog: () => TFetch[];
  setFetcherLog: (next: TFetch[]) => void;
  getWorkspaceItems: () => any[];
  setWorkspaceItems: (next: any[]) => void;
}

/** Operations exposed by the cleanup service. */
export interface CleanupService {
  removeConversationsByIds: (ids: string[]) => { deleted: number };
  removeOrchestrationByIds: (ids: string[]) => { deleted: number };
  removeProviderEventsByIds: (ids: string[]) => { deleted: number };
  removeTracesByIds: (ids: string[]) => { deleted: number };
  removeFetcherLogsByIds: (ids: string[]) => { deleted: number };
  removeWorkspaceItemsByIds: (ids: string[]) => { deleted: number };
  getStats: () => CleanupStats;
  purgeAll: () => { deleted: CleanupStats; message: string };
  purge: (type: 'fetcher' | 'orchestration' | 'conversations' | 'workspaceItems' | 'providerEvents' | 'traces') => { deleted: number; message: string };
}

/**
 * Builds an ids-only cleanup service that operates via the provided repository accessors.
 */
export function createCleanupService(hub: RepositoryHub): CleanupService {

  const removeByIds = (list: any[], ids: string[], cascade?: (e: any) => boolean) => {
    const before = list.length;
    const set = new Set(ids);
    const next = ids.length ? list.filter((e: any) => {
      if (set.has(e.id)) return false;
      if (cascade && cascade(e)) return false;
      return true;
    }) : list;
    const deleted = before - next.length;
    return { next, deleted };
  };

  return {
    removeConversationsByIds(ids: string[]) {
      const cur = hub.getConversations();
      const { next, deleted } = removeByIds(cur, ids, (c) => c.parentId && ids.includes(c.parentId));
      if (next !== cur) hub.setConversations(next);
      logger.info('CLEANUP removeConversationsByIds', { deleted });
      return { deleted };
    },
    removeOrchestrationByIds(ids: string[]) {
      const cur = hub.getOrchestrationLog();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setOrchestrationLog(next);
      logger.info('CLEANUP removeOrchestrationByIds', { deleted });
      return { deleted };
    },
    removeProviderEventsByIds(ids: string[]) {
      const cur = hub.getProviderEvents();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setProviderEvents(next);
      logger.info('CLEANUP removeProviderEventsByIds', { deleted });
      return { deleted };
    },
    removeTracesByIds(ids: string[]) {
      const cur = hub.getTraces();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setTraces(next);
      logger.info('CLEANUP removeTracesByIds', { deleted });
      return { deleted };
    },
    removeFetcherLogsByIds(ids: string[]) {
      const cur = hub.getFetcherLog();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setFetcherLog(next);
      logger.info('CLEANUP removeFetcherLogsByIds', { deleted });
      return { deleted };
    },
    removeWorkspaceItemsByIds(ids: string[]) {
      const cur = hub.getWorkspaceItems();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setWorkspaceItems(next);
      logger.info('CLEANUP removeWorkspaceItemsByIds', { deleted });
      return { deleted };
    },
    getStats() {
      const fetcherLogs = hub.getFetcherLog().length;
      const orchestrationLogs = hub.getOrchestrationLog().length;
      const conversations = hub.getConversations().length;
      const workspaceItems = hub.getWorkspaceItems().length;
      const providerEvents = hub.getProviderEvents().length;
      const traces = hub.getTraces().length;
      return {
        fetcherLogs,
        orchestrationLogs,
        conversations,
        workspaceItems,
        providerEvents,
        traces,
        total: fetcherLogs + orchestrationLogs + conversations + workspaceItems + providerEvents + traces,
      };
    },
    purgeAll() {
      const before = this.getStats();
      hub.setFetcherLog([]);
      hub.setOrchestrationLog([]);
      hub.setConversations([]);
      hub.setWorkspaceItems([]);
      hub.setProviderEvents([]);
      hub.setTraces([]);
      logger.info('CLEANUP purgeAll', { totals: before });
      return { deleted: before, message: 'All logs and data purged successfully' };
    },
    purge(type) {
      switch (type) {
        case 'fetcher': {
          const count = hub.getFetcherLog().length;
          hub.setFetcherLog([]);
          logger.info('CLEANUP purge(fetcher)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} fetcher logs` };
        }
        case 'orchestration': {
          const count = hub.getOrchestrationLog().length;
          hub.setOrchestrationLog([]);
          logger.info('CLEANUP purge(orchestration)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} orchestration logs` };
        }
        case 'conversations': {
          const count = hub.getConversations().length;
          hub.setConversations([]);
          logger.info('CLEANUP purge(conversations)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} conversations` };
        }
        case 'workspaceItems': {
          const count = hub.getWorkspaceItems().length;
          hub.setWorkspaceItems([]);
          logger.info('CLEANUP purge(workspaceItems)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} workspace items` };
        }
        case 'providerEvents': {
          const count = hub.getProviderEvents().length;
          hub.setProviderEvents([]);
          logger.info('CLEANUP purge(providerEvents)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} provider events` };
        }
        case 'traces': {
          const count = hub.getTraces().length;
          hub.setTraces([]);
          logger.info('CLEANUP purge(traces)', { deleted: count });
          return { deleted: count, message: `Deleted ${count} traces` };
        }
        default: {
          const _ex: never = type as never;
          throw new Error(`Unknown cleanup type: ${_ex}`);
        }
      }
    },
  };
}
