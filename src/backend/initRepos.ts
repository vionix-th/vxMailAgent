import { User } from '../shared/types';
import { USERS_FILE } from './utils/paths';
import { createJsonRepository } from './repository/fileRepositories';
import { setUsersRepo } from './services/users';
import { createLiveRepos, LiveRepos } from './liveRepos';

/** Initialize system-level repositories and return live per-user repo accessors. */
export function initRepos(): LiveRepos {
  // System-level repository: users
  const usersRepo = createJsonRepository<User>(USERS_FILE);
  setUsersRepo(usersRepo);

  // Live per-user repositories
  return createLiveRepos();
}
