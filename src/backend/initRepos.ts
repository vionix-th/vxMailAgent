import { configureSqliteFactory, repoBundleRegistry } from './repository/registry';
import { SqliteConnectionFactory, SystemUsersRepository } from './storage/sqlite';
import { setUserAccountsRepo } from './services/users';
import { createLiveRepos, LiveRepos } from './liveRepos';

let currentFactory: SqliteConnectionFactory | null = null;

/** Initialize SQLite-backed repositories and return live per-user repo accessors. */
export function initRepos(): LiveRepos {
  const factory = new SqliteConnectionFactory();
  currentFactory = factory;
  configureSqliteFactory(factory);

  const sharedHandle = factory.getSharedHandle();
  const systemUsers = new SystemUsersRepository(sharedHandle);
  setUserAccountsRepo(systemUsers);

  // Ensure registry timer is running (already constructed at import time)
  void repoBundleRegistry; // no-op reference to satisfy lint

  return createLiveRepos();
}

export async function shutdownRepos(): Promise<void> {
  if (currentFactory) {
    await currentFactory.closeAll();
    currentFactory = null;
  }
  repoBundleRegistry.destroy();
}
