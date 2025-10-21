import { FETCHER_BOOTSTRAP_CONCURRENCY } from '../config';
import { getUserAccountsRepo } from './users';
import { repoBundleRegistry } from '../repository/registry';
import logger from './logger';
import { RepositoryError } from './error-handler';
import type { FetcherLogEntry } from '../../shared/types';
import type { FetcherManager } from './fetcher-manager';
import { newId } from '../utils/id';

/**
 * Bootstraps per-user fetchers for users who enabled auto-start.
 * Intended to be invoked after the HTTP server is listening.
 */
export async function bootstrapFetchers(fetcherManager: FetcherManager): Promise<void> {
  try {
    const users = await getUserAccountsRepo().list();
    const limit = Math.max(1, FETCHER_BOOTSTRAP_CONCURRENCY || 1);

    async function worker(u: any) {
      const uid = (u as any).id as string;
      try {
        const bundle = await repoBundleRegistry.getBundle(uid);
        const settings = await bundle.settings.load();
        if (!settings) {
          logger.info('Boot: settings not initialized for user; skipping autostart', { uid });
          return;
        }
        if (settings.fetcherAutoStart !== true) return;

        try {
          await fetcherManager.startForUid(uid);
          logger.info('Boot: started fetcher loop', { uid });
          // Log to per-user fetcher log as well (await async repo I/O)
          const entry: FetcherLogEntry = {
            id: newId(),
            timestamp: new Date().toISOString(),
            level: 'info',
            provider: null,
            accountId: 'all',
            event: 'boot_autostart',
            message: 'Fetcher loop auto-started on server boot',
            emailId: null
          };
          await fetcherManager.appendFetcherLogForUid(uid, entry);
        } catch (e) {
          logger.error('Boot: failed to start fetcher loop', { uid, err: e });
          try {
            const entry: FetcherLogEntry = {
              id: newId(),
              timestamp: new Date().toISOString(),
              level: 'error',
              provider: null,
              accountId: 'all',
              event: 'boot_autostart_failed',
              message: 'Failed to auto-start fetcher loop on server boot',
              emailId: null,
              detail: String((e as any)?.message || e)
            };
            await fetcherManager.appendFetcherLogForUid(uid, entry);
          } catch (e2: any) {
            logger.warn('Boot: failed to write boot_autostart_failed entry to user fetcher log', { uid, error: e2?.message || String(e2) });
          }
        }
      } catch (e) {
        if (e instanceof RepositoryError && e.code === 'SETTINGS_NOT_INITIALIZED') {
          logger.info('Boot: skipping fetcher autostart, settings not initialized', { uid });
          return;
        }
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
