import { FETCHER_BOOTSTRAP_CONCURRENCY } from '../config';
import { getUsersRepo } from './users';
import { repoBundleRegistry } from '../repository/registry';
import logger from './logger';
import type { FetcherLogEntry } from '../../shared/types';
import type { FetcherManager } from './fetcher-manager';

/**
 * Bootstraps per-user fetchers for users who enabled auto-start.
 * Intended to be invoked after the HTTP server is listening.
 */
export async function bootstrapFetchers(fetcherManager: FetcherManager): Promise<void> {
  try {
    const users = await getUsersRepo().getAll();
    const limit = Math.max(1, FETCHER_BOOTSTRAP_CONCURRENCY || 1);

    async function worker(u: any) {
      const uid = (u as any).id as string;
      try {
        const bundle = await repoBundleRegistry.getBundle(uid);
        const settingsArr = await bundle.settings.getAll();
        const settings = settingsArr[0] || {};
        if (!settings.fetcherAutoStart) return;

        try {
          await fetcherManager.startForUid(uid);
          logger.info('Boot: started fetcher loop', { uid });
          // Log to per-user fetcher log as well (await async repo I/O)
          const cur: FetcherLogEntry[] = await fetcherManager.getFetcherLogForUid(uid) as any;
          const entry: FetcherLogEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'boot_autostart',
            message: 'Fetcher loop auto-started on server boot'
          } as any;
          await fetcherManager.setFetcherLogForUid(uid, [...cur, entry] as any);
        } catch (e) {
          logger.error('Boot: failed to start fetcher loop', { uid, err: e });
          try {
            const cur: FetcherLogEntry[] = await fetcherManager.getFetcherLogForUid(uid) as any;
            const entry: FetcherLogEntry = {
              timestamp: new Date().toISOString(),
              level: 'error',
              event: 'boot_autostart_failed',
              message: 'Failed to auto-start fetcher loop on server boot',
              detail: String((e as any)?.message || e)
            } as any;
            await fetcherManager.setFetcherLogForUid(uid, [...cur, entry] as any);
          } catch {}
        }
      } catch (e) {
        logger.error('Boot: error preparing user bundle', { uid, err: e });
      }
    }

    // Simple concurrency limiter
    const queue = users.slice();
    const runners: Promise<void>[] = [];
    for (let i = 0; i < Math.min(limit, queue.length); i++) {
      runners.push((async function run() {
        while (queue.length) {
          const next = queue.shift();
          if (!next) break;
          await worker(next);
        }
      })());
    }

    // Fire-and-forget background bootstrap
    void Promise.allSettled(runners).then((results) => {
      const rejected = results.filter(r => r.status === 'rejected').length;
      logger.info('Boot: fetcher bootstrap completed', { users: users.length, concurrency: limit, errors: rejected });
    }).catch((e) => {
      logger.error('Boot: fetcher bootstrap pool error', { err: e });
    });
  } catch (e) {
    logger.error('Boot: fetcher bootstrap failed', { err: e });
  }
}
