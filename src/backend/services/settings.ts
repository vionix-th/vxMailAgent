import fs from 'fs';
import { loadAndDecrypt } from '../persistence';
import { SETTINGS_FILE } from '../utils/paths';

import type { ApiConfig } from '../../shared/types';

export interface Settings {
  virtualRoot: string;
  apiConfigs: ApiConfig[];
  signatures: Record<string, string>;
  fetcherAutoStart: boolean;
  sessionTimeoutMinutes: number;
  // allow unknowns for forward-compat without typing explosion
  [key: string]: any;
}

/** Load settings from disk or return defaults if unavailable. */
export function loadSettings(): Settings {
  let settings: Settings;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = loadAndDecrypt(SETTINGS_FILE) as Settings;
    } else {
      settings = defaultSettings();
    }
    // Ensure required fields exist for forward-compat
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

/** Default settings used when none are persisted. */
function defaultSettings(): Settings {
  return {
    virtualRoot: '',
    apiConfigs: [] as ApiConfig[],
    signatures: {},
    fetcherAutoStart: true,
    sessionTimeoutMinutes: 15,
  } as Settings;
}
