import { LiveRepos } from '../liveRepos';
import { EmailFetcher, FetchContext } from './email-fetcher';
import type { ReqLike } from '../interfaces';
import { requireReq } from '../utils/repo-access';
import { FetcherLogEntry } from '../../shared/types';
import { newId } from '../utils/id';
import logger from './logger';

/** Initialize the background fetcher with refactored modular architecture. */
export function initFetcher(
  repos: LiveRepos,
  userReq: ReqLike
) {
  const { userContext } = requireReq(userReq);
  const fetcherReq: ReqLike = {
    userContext: {
      uid: userContext.uid,
      repos: userContext.repos,
    },
  };

  let fetcherActive = false;
  let fetcherInterval: NodeJS.Timeout | null = null;
  let fetcherLastRun: string | null = null;
  let fetcherNextRun: string | null = null;
  let fetcherRunning = false;
  let fetcherAccountStatus: Record<string, { lastRun: string | null; lastError: string | null }> = {};

  async function logFetch(entry: FetcherLogEntry) {
    try {
      if (typeof entry.id !== 'string' || !entry.id) {
        throw new Error('FetcherLogEntry.id required');
      }
      const withId: FetcherLogEntry = entry;
      const current = await repos.getFetcherLog(fetcherReq);
      const updated = [...current, withId];
      void repos.setFetcherLog(fetcherReq, updated).catch(e =>
        logger.error('Failed to persist fetcherLog entry', { err: e })
      );
    } catch (e) {
      logger.error('Failed to create fetcherLog entry', { err: e });
    }
  }

  const emailFetcher = new EmailFetcher(
    repos,
    logFetch
  );

  async function fetchEmails() {
    if (fetcherRunning) {
      void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'warn', accountId: 'all', event: 'cycle_skip', message: 'Fetch cycle already running; skipping re-entry' });
      return;
    }
    fetcherRunning = true;
    fetcherLastRun = new Date().toISOString();
    fetcherNextRun = null;
    
    try {
      const settings = await repos.getSettings(fetcherReq);
      const filters = await repos.getFilters(fetcherReq);
      const directors = await repos.getDirectors(fetcherReq);
      const agents = await repos.getAgents(fetcherReq);
      const accounts = await repos.getAccounts(fetcherReq);
      
      // Update account status for all accounts
      for (const account of accounts) {
        fetcherAccountStatus[account.id] = { lastRun: new Date().toISOString(), lastError: null };
      }
      
      const fetchContext: FetchContext = {
        userReq: fetcherReq,
        settings,
        filters,
        directors,
        agents,
        accounts
      };
      
      await emailFetcher.fetchEmails(fetchContext);
    } catch (e) {
      await logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'error', accountId: 'all', event: 'cycle_error', message: 'Error during fetch cycle', detail: String(e) });
    } finally {
      fetcherRunning = false;
    }
  }

  function startFetcherLoop() {
    if (fetcherActive) return;
    fetcherActive = true;
    fetcherNextRun = new Date(Date.now() + 60000).toISOString();
    fetcherInterval = setInterval(() => void fetchEmails(), 60000);
    void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'info', accountId: 'all', event: 'fetcher_started', message: 'Background fetcher loop started' });
  }

  function stopFetcherLoop() {
    fetcherActive = false;
    fetcherNextRun = null;
    if (fetcherInterval) clearInterval(fetcherInterval);
    fetcherInterval = null;
    void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'info', accountId: 'all', event: 'fetcher_stopped', message: 'Background fetcher loop stopped' });
  }

  async function getFetcherLog(): Promise<FetcherLogEntry[]> {
    return repos.getFetcherLog(fetcherReq);
  }

  async function setFetcherLog(next: FetcherLogEntry[]): Promise<void> {
    return repos.setFetcherLog(fetcherReq, next);
  }

  function getStatus() {
    return {
      active: fetcherActive,
      running: fetcherRunning,
      lastRun: fetcherLastRun,
      nextRun: fetcherNextRun,
      accountStatus: fetcherAccountStatus
    };
  }

  return {
    getStatus,
    startFetcherLoop,
    stopFetcherLoop,
    fetchEmails,
    getFetcherLog,
    setFetcherLog
  };
}
