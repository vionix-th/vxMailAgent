import { LiveRepos } from '../liveRepos';
import { EmailFetcher, FetchContext } from './email-fetcher';
import type { ContextInput } from '../utils/repo-access';
import { requireContext } from '../utils/repo-access';
import { FetcherLogEntry } from '../../shared/types';
import { newId } from '../utils/id';
import logger from './logger';
import { validateFetcherLogEntry, validateFetcherLogEntries } from './fetcher-log-validation';

/** Initialize the background fetcher with refactored modular architecture. */
export function initFetcher(
  repos: LiveRepos,
  userReq: ContextInput
) {
  const { userContext } = requireContext(userReq);
  const fetcherReq: ContextInput = {
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
      const validated = validateFetcherLogEntry(entry, 'fetcherLog');
      await repos.appendFetcherLog(fetcherReq, validated);
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
      void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'warn', provider: null, emailId: null, accountId: 'all', event: 'cycle_skip', message: 'Fetch cycle already running; skipping re-entry' });
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

      const ensureAccountStatus = (accountId: string) => {
        const existing = fetcherAccountStatus[accountId];
        if (existing) return existing;
        const created = { lastRun: null, lastError: null };
        fetcherAccountStatus[accountId] = created;
        return created;
      };

      const latestAccountIds = new Set(accounts.map((account: any) => account.id));
      for (const existingId of Object.keys(fetcherAccountStatus)) {
        if (!latestAccountIds.has(existingId)) {
          delete fetcherAccountStatus[existingId];
        }
      }

      for (const account of accounts) {
        ensureAccountStatus(account.id);
      }

      const markAccountSuccess = (accountId: string) => {
        const status = ensureAccountStatus(accountId);
        status.lastRun = new Date().toISOString();
        status.lastError = null;
      };

      const markAccountError = (accountId: string, errorMessage: string) => {
        const status = ensureAccountStatus(accountId);
        status.lastRun = new Date().toISOString();
        status.lastError = typeof errorMessage === 'string' && errorMessage.trim().length > 0
          ? errorMessage
          : 'account_processing_failed';
      };
      
      const fetchContext: FetchContext = {
        userReq: fetcherReq,
        settings,
        filters,
        directors,
        agents,
        accounts,
        onAccountSuccess: markAccountSuccess,
        onAccountError: markAccountError
      };
      
      await emailFetcher.fetchEmails(fetchContext);
    } catch (e) {
      await logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'error', provider: null, emailId: null, accountId: 'all', event: 'cycle_error', message: 'Error during fetch cycle', detail: String(e) });
    } finally {
      fetcherRunning = false;
    }
  }

  function startFetcherLoop() {
    if (fetcherActive) return;
    fetcherActive = true;
    fetcherNextRun = new Date(Date.now() + 60000).toISOString();
    fetcherInterval = setInterval(() => void fetchEmails(), 60000);
    void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'info', provider: null, emailId: null, accountId: 'all', event: 'fetcher_started', message: 'Background fetcher loop started' });
  }

  function stopFetcherLoop() {
    fetcherActive = false;
    fetcherNextRun = null;
    if (fetcherInterval) clearInterval(fetcherInterval);
    fetcherInterval = null;
    void logFetch({ id: newId(), timestamp: new Date().toISOString(), level: 'info', provider: null, emailId: null, accountId: 'all', event: 'fetcher_stopped', message: 'Background fetcher loop stopped' });
  }

  async function getFetcherLog(): Promise<FetcherLogEntry[]> {
    return repos.getFetcherLog(fetcherReq);
  }

  async function setFetcherLog(next: FetcherLogEntry[]): Promise<void> {
    const validated = validateFetcherLogEntries(next, 'fetcherLog');
    return repos.replaceFetcherLog(fetcherReq, validated);
  }

  async function deleteFetcherLog(id: string): Promise<boolean> {
    return repos.deleteFetcherLog(fetcherReq, id);
  }

  async function deleteFetcherLogs(ids: readonly string[]): Promise<number> {
    return repos.deleteFetcherLogs(fetcherReq, ids);
  }

  async function clearFetcherLog(): Promise<void> {
    return repos.clearFetcherLog(fetcherReq);
  }

  async function appendFetcherLog(entry: FetcherLogEntry): Promise<void> {
    const validated = validateFetcherLogEntry(entry, 'fetcherLog');
    await repos.appendFetcherLog(fetcherReq, validated);
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
    setFetcherLog,
    appendFetcherLog,
    deleteFetcherLog,
    deleteFetcherLogs,
    clearFetcherLog
  };
}
