import fs from 'fs';
import { loadAndDecrypt } from '../persistence';
import { dataPath } from '../utils/paths';

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

/** Load settings from the encrypted JSON file. */
export function loadSettings(): Settings {
  let settings: Settings;
  try {
    const settingsFile = dataPath('settings.json');
    if (fs.existsSync(settingsFile)) {
      settings = loadAndDecrypt(settingsFile) as Settings;
    } else {
      settings = defaultSettings();
    }
    if (!Array.isArray(settings.apiConfigs)) settings.apiConfigs = [] as ApiConfig[];
    if (!settings.signatures || typeof settings.signatures !== 'object') settings.signatures = {};
    if (typeof settings.fetcherAutoStart !== 'boolean') settings.fetcherAutoStart = true;
    if (typeof settings.sessionTimeoutMinutes !== 'number') settings.sessionTimeoutMinutes = 15;

    console.log('[DEBUG] Loaded settings from disk');
  } catch (e) {
    console.error('[ERROR] Failed to load settings:', e);
    settings = defaultSettings();
  }
  return settings;
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
