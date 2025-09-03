import { LiveRepos } from '../liveRepos';
import { EmailFetcher, FetchContext } from './email-fetcher';
import type { ReqLike } from '../interfaces';
import { FetcherLogEntry } from '../../shared/types';
import { newId } from '../utils/id';
import logger from './logger';

/** Initialize the background fetcher with refactored modular architecture. */
export function initFetcher(
  repos: LiveRepos,
  userReq: ReqLike
) {
  let fetcherActive = false;
  let fetcherInterval: NodeJS.Timeout | null = null;
  let fetcherLastRun: string | null = null;
  let fetcherNextRun: string | null = null;
  let fetcherRunning = false;
  let fetcherAccountStatus: Record<string, { lastRun: string | null; lastError: string | null }> = {};

  async function logFetch(entry: FetcherLogEntry) {
    try {
      const withId: FetcherLogEntry = { ...entry, id: entry.id || newId() };
      const current = await repos.getFetcherLog(userReq);
      const updated = [...current, withId];
      // Fire-and-forget async write - don't block email processing
      void repos.setFetcherLog(userReq, updated).catch(e => 
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
      logFetch({ timestamp: new Date().toISOString(), level: 'warn', event: 'cycle_skip', message: 'Fetch cycle already running; skipping re-entry' });
      return;
    }
    fetcherRunning = true;
    fetcherLastRun = new Date().toISOString();
    fetcherNextRun = null;
    
    try {
      const settings = await repos.getSettings(userReq);
      const filters = await repos.getFilters(userReq);
      const directors = await repos.getDirectors(userReq);
      const agents = await repos.getAgents(userReq);
      const accounts = await repos.getAccounts(userReq);
      
      // Update account status for all accounts
      for (const account of accounts) {
        fetcherAccountStatus[account.id] = { lastRun: new Date().toISOString(), lastError: null };
      }
      
      const fetchContext: FetchContext = {
        userReq: userReq as any,
        settings,
        filters,
        directors,
        agents,
        accounts
      };
      
      await emailFetcher.fetchEmails(fetchContext);
    } catch (e) {
      logFetch({ timestamp: new Date().toISOString(), level: 'error', event: 'cycle_error', message: 'Error during fetch cycle', detail: String(e) });
    } finally {
      fetcherRunning = false;
    }
  }

  function startFetcherLoop() {
    if (fetcherActive) return;
    fetcherActive = true;
    fetcherNextRun = new Date(Date.now() + 60000).toISOString();
    fetcherInterval = setInterval(() => void fetchEmails(), 60000);
    logFetch({ timestamp: new Date().toISOString(), level: 'info', event: 'fetcher_started', message: 'Background fetcher loop started' });
  }

  function stopFetcherLoop() {
    fetcherActive = false;
    fetcherNextRun = null;
    if (fetcherInterval) clearInterval(fetcherInterval);
    fetcherInterval = null;
    logFetch({ timestamp: new Date().toISOString(), level: 'info', event: 'fetcher_stopped', message: 'Background fetcher loop stopped' });
  }

  async function getFetcherLog(): Promise<FetcherLogEntry[]> {
    return repos.getFetcherLog(userReq);
  }

  async function setFetcherLog(next: FetcherLogEntry[]): Promise<void> {
    return repos.setFetcherLog(userReq, next);
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
