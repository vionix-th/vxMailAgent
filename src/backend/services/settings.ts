import logger from './logger';
import { requireReq, repoGetAll, repoSetAll, requireUid, ReqLike } from '../utils/repo-access';

import type { ApiConfig } from '../../shared/types';

/** Application settings loaded from disk. */
export interface Settings {
  virtualRoot: string;
  apiConfigs: ApiConfig[];
  signatures: Record<string, string>;
  fetcherAutoStart: boolean;
  sessionTimeoutMinutes: number;
  [key: string]: any;
}

/** Load settings from the per-user repository (single settings object). */
export function loadSettings(req?: ReqLike): Settings {
  try {
    const ureq = requireReq(req);
    const all = repoGetAll<Settings>(ureq, 'settings');
    const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();
    // Normalize defaults
    if (!Array.isArray(settings.apiConfigs)) settings.apiConfigs = [] as ApiConfig[];
    if (!settings.signatures || typeof settings.signatures !== 'object') settings.signatures = {};
    if (typeof settings.fetcherAutoStart !== 'boolean') settings.fetcherAutoStart = true;
    if (typeof settings.sessionTimeoutMinutes !== 'number') settings.sessionTimeoutMinutes = 15;
    logger.debug('Loaded settings', { uid: requireUid(ureq) });
    return settings;
  } catch (e) {
    logger.error('Failed to load settings', { err: e });
    return defaultSettings();
  }
}

/** Save settings to the per-user repository. */
export function saveSettings(settings: Settings, req: ReqLike): void {
  const ureq = requireReq(req);
  try {
    repoSetAll<Settings>(ureq, 'settings', [settings]);
    logger.debug('Saved settings', { uid: requireUid(ureq) });
  } catch (e) {
    logger.error('Failed to save settings', { err: e });
    throw e;
  }
}

/** Default settings when none exist on disk. */
function defaultSettings(): Settings {
  return {
    virtualRoot: '',
    apiConfigs: [] as ApiConfig[],
    signatures: {},
    fetcherAutoStart: true,
    sessionTimeoutMinutes: 15,
  } as Settings;
}

