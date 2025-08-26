import path from 'path';
import { DATA_DIR } from '../persistence';

/** Resolves a file path within the persistent data directory. */
export const dataPath = (name: string) => path.join(DATA_DIR, name);

export const ACCOUNTS_FILE = dataPath('accounts.json');
export const AGENTS_FILE = dataPath('agents.json');
export const DIRECTORS_FILE = dataPath('directors.json');
export const FILTERS_FILE = dataPath('filters.json');
export const PROMPTS_FILE = dataPath('prompts.json');
export const TEMPLATES_FILE = dataPath('prompt-templates.json');
export const IMPRINTS_FILE = dataPath('imprints.json');
export const ORCHESTRATION_LOG_FILE = dataPath('orchestrationLog.json');
export const CONVERSATIONS_FILE = dataPath('orchestrationConversations.json');
export const PROVIDER_EVENTS_FILE = dataPath('providerEvents.json');
export const SETTINGS_FILE = dataPath('settings.json');
export const FETCHER_LOG_FILE = dataPath('fetcherLog.json');
export const MEMORY_FILE = dataPath('memory.json');
export const TRACES_FILE = dataPath('traces.json');
export const WORKSPACE_ITEMS_FILE = dataPath('workspaceItems.json');
export const USERS_FILE = dataPath('users.json');

export { DATA_DIR } from '../persistence';
