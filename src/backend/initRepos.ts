import { configureSqliteFactory, repoBundleRegistry } from './repository/registry';
import { SqliteConnectionFactory, SystemUsersRepository } from './storage/sqlite';
import { setUserAccountsRepo } from './services/users';
import { createLiveRepos, LiveRepos } from './liveRepos';
import logger from './services/logger';

let currentFactory: SqliteConnectionFactory | null = null;

/** Initialize SQLite-backed repositories and return live per-user repo accessors. */
export function initRepos(): LiveRepos {
  try {
    const factory = new SqliteConnectionFactory();
    currentFactory = factory;
    configureSqliteFactory(factory);

    const sharedHandle = factory.getSharedHandle();
    const systemUsers = new SystemUsersRepository(sharedHandle);
    setUserAccountsRepo(systemUsers);

    // Ensure registry timer is running (already constructed at import time)
    void repoBundleRegistry; // no-op reference to satisfy lint

    return createLiveRepos();
  } catch (error) {
    logger.error('Repository initialization failed', { err: error });
    throw error;
  }
}

export async function shutdownRepos(): Promise<void> {
  const errors: Error[] = [];
  const factory = currentFactory;
  currentFactory = null;

  if (factory) {
    try {
      await factory.closeAll();
    } catch (error) {
      logger.error('Repository shutdown failed while closing connections', { err: error });
      if (error instanceof Error) errors.push(error);
      else errors.push(new Error(String(error)));
    }
  }

  try {
    repoBundleRegistry.destroy();
  } catch (error) {
    logger.error('Repository shutdown failed while destroying registry', { err: error });
    if (error instanceof Error) errors.push(error);
    else errors.push(new Error(String(error)));
  }

  if (errors.length) {
    throw errors[0];
  }
}
