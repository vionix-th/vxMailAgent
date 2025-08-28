import fs from 'fs';
import { loadAndDecrypt } from '../persistence';
import { userPaths } from '../utils/paths';
import { UserRequest, hasUserContext, getUserContext } from '../middleware/user-context';

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

/** Load settings from the encrypted JSON file for a specific user. */
export function loadSettings(req?: UserRequest): Settings {
  let settings: Settings;
  try {
    if (!req || !hasUserContext(req)) {
      throw new Error('User context required - no global settings available');
    }
    
    const userContext = getUserContext(req);
    const settingsFile = userPaths(userContext.uid).settings;
    
    if (fs.existsSync(settingsFile)) {
      settings = loadAndDecrypt(settingsFile) as Settings;
    } else {
      settings = defaultSettings();
    }
    if (!Array.isArray(settings.apiConfigs)) settings.apiConfigs = [] as ApiConfig[];
    if (!settings.signatures || typeof settings.signatures !== 'object') settings.signatures = {};
    if (typeof settings.fetcherAutoStart !== 'boolean') settings.fetcherAutoStart = true;
    if (typeof settings.sessionTimeoutMinutes !== 'number') settings.sessionTimeoutMinutes = 15;

    console.log(`[DEBUG] Loaded settings for user ${userContext.uid}`);
  } catch (e) {
    console.error('[ERROR] Failed to load settings:', e);
    settings = defaultSettings();
  }
  return settings;
}

/** Save settings to the encrypted JSON file for a specific user. */
export function saveSettings(settings: Settings, req: UserRequest): void {
  if (!hasUserContext(req)) {
    throw new Error('User context required - no global settings available');
  }
  
  const userContext = getUserContext(req);
  const settingsFile = userPaths(userContext.uid).settings;
  
  try {
    const { encryptAndPersist } = require('../persistence');
    encryptAndPersist(settings, settingsFile);
    console.log(`[DEBUG] Saved settings for user ${userContext.uid}`);
  } catch (e) {
    console.error('[ERROR] Failed to save settings:', e);
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
