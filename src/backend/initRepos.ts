import { User } from '../shared/types';
import { USER_ACCOUNTS_FILE, DATA_DIR } from './utils/paths';
import { createSystemJsonRepository } from './repository/fileRepositories';
import { setUserAccountsRepo } from './services/users';
import { createLiveRepos, LiveRepos } from './liveRepos';

/** Initialize system-level repositories and return live per-user repo accessors. */
export function initRepos(): LiveRepos {
  // System-level repository: users
  const userAccountsRepo = createSystemJsonRepository<User>(USER_ACCOUNTS_FILE, DATA_DIR);
  setUserAccountsRepo(userAccountsRepo);

  // Live per-user repositories
  return createLiveRepos();
}
