import { CleanupStats } from '../../shared/types';

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
}

/** Operations exposed by the cleanup service. */
export interface CleanupService {
  removeConversationsByIds: (ids: string[]) => { deleted: number };
  removeOrchestrationByIds: (ids: string[]) => { deleted: number };
  removeProviderEventsByIds: (ids: string[]) => { deleted: number };
  removeTracesByIds: (ids: string[]) => { deleted: number };
  removeFetcherLogsByIds: (ids: string[]) => { deleted: number };
  getStats: () => CleanupStats;
  purgeAll: () => { deleted: CleanupStats; message: string };
  purge: (type: 'fetcher' | 'orchestration' | 'conversations' | 'providerEvents' | 'traces') => { deleted: number; message: string };
}

/**
 * Builds an ids-only cleanup service that operates via the provided repository accessors.
 */
export function createCleanupService(hub: RepositoryHub): CleanupService {
  const isoNow = () => new Date().toISOString();

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
      console.log(`[${isoNow()}] CLEANUP removeConversationsByIds: deleted=${deleted}`);
      return { deleted };
    },
    removeOrchestrationByIds(ids: string[]) {
      const cur = hub.getOrchestrationLog();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setOrchestrationLog(next);
      console.log(`[${isoNow()}] CLEANUP removeOrchestrationByIds: deleted=${deleted}`);
      return { deleted };
    },
    removeProviderEventsByIds(ids: string[]) {
      const cur = hub.getProviderEvents();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setProviderEvents(next);
      console.log(`[${isoNow()}] CLEANUP removeProviderEventsByIds: deleted=${deleted}`);
      return { deleted };
    },
    removeTracesByIds(ids: string[]) {
      const cur = hub.getTraces();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setTraces(next);
      console.log(`[${isoNow()}] CLEANUP removeTracesByIds: deleted=${deleted}`);
      return { deleted };
    },
    removeFetcherLogsByIds(ids: string[]) {
      const cur = hub.getFetcherLog();
      const { next, deleted } = removeByIds(cur, ids);
      if (next !== cur) hub.setFetcherLog(next);
      console.log(`[${isoNow()}] CLEANUP removeFetcherLogsByIds: deleted=${deleted}`);
      return { deleted };
    },
    getStats() {
      const fetcherLogs = hub.getFetcherLog().length;
      const orchestrationLogs = hub.getOrchestrationLog().length;
      const conversations = hub.getConversations().length;
      const providerEvents = hub.getProviderEvents().length;
      const traces = hub.getTraces().length;
      return {
        fetcherLogs,
        orchestrationLogs,
        conversations,
        providerEvents,
        traces,
        total: fetcherLogs + orchestrationLogs + conversations + providerEvents + traces,
      };
    },
    purgeAll() {
      const before = this.getStats();
      hub.setFetcherLog([]);
      hub.setOrchestrationLog([]);
      hub.setConversations([]);
      hub.setProviderEvents([]);
      hub.setTraces([]);
      const msg = `[${isoNow()}] CLEANUP purgeAll: deleted totals -> fetcher=${before.fetcherLogs}, orch=${before.orchestrationLogs}, conv=${before.conversations}, providerEvents=${before.providerEvents}, traces=${before.traces}`;
      console.log(msg);
      return { deleted: before, message: 'All logs and data purged successfully' };
    },
    purge(type) {
      switch (type) {
        case 'fetcher': {
          const count = hub.getFetcherLog().length;
          hub.setFetcherLog([]);
          console.log(`[${isoNow()}] CLEANUP purge(fetcher): deleted=${count}`);
          return { deleted: count, message: `Deleted ${count} fetcher logs` };
        }
        case 'orchestration': {
          const count = hub.getOrchestrationLog().length;
          hub.setOrchestrationLog([]);
          console.log(`[${isoNow()}] CLEANUP purge(orchestration): deleted=${count}`);
          return { deleted: count, message: `Deleted ${count} orchestration logs` };
        }
        case 'conversations': {
          const count = hub.getConversations().length;
          hub.setConversations([]);
          console.log(`[${isoNow()}] CLEANUP purge(conversations): deleted=${count}`);
          return { deleted: count, message: `Deleted ${count} conversations` };
        }
        case 'providerEvents': {
          const count = hub.getProviderEvents().length;
          hub.setProviderEvents([]);
          console.log(`[${isoNow()}] CLEANUP purge(providerEvents): deleted=${count}`);
          return { deleted: count, message: `Deleted ${count} provider events` };
        }
        case 'traces': {
          const count = hub.getTraces().length;
          hub.setTraces([]);
          console.log(`[${isoNow()}] CLEANUP purge(traces): deleted=${count}`);
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
