import logger from './logger';
import { requireReq, repoGetAll, repoSetAll, requireUid, ReqLike } from '../utils/repo-access';

import type { ApiConfigPublic } from '../../shared/types';

/** Application settings loaded from disk. */
export interface Settings {
  virtualRoot: string;
  apiConfigs: ApiConfigPublic[];
  signatures: Record<string, string>;
  fetcherAutoStart: boolean;
  sessionTimeoutMinutes: number;
  [key: string]: any;
}

/** Load settings from the per-user repository (single settings object). */
export async function loadSettings(req?: ReqLike): Promise<Settings> {
  const ureq = requireReq(req);
  const all = await repoGetAll<Settings>(ureq, 'settings');
  // Only default when absent; do not mask corruption/errors (repoGetAll would have thrown)
  const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();
  // Normalize defaults
  if (!Array.isArray(settings.apiConfigs)) settings.apiConfigs = [] as ApiConfigPublic[];
  if (!settings.signatures || typeof settings.signatures !== 'object') settings.signatures = {};
  if (typeof settings.fetcherAutoStart !== 'boolean') settings.fetcherAutoStart = true;
  if (typeof settings.sessionTimeoutMinutes !== 'number') settings.sessionTimeoutMinutes = 15;
  logger.debug('Loaded settings', { uid: requireUid(ureq) });
  return settings;
}

/** Save settings to the per-user repository. */
export async function saveSettings(settings: Settings, req: ReqLike): Promise<void> {
  const ureq = requireReq(req);
  try {
    await repoSetAll<Settings>(ureq, 'settings', [settings]);
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
    apiConfigs: [] as ApiConfigPublic[],
    signatures: {},
    fetcherAutoStart: true,
    sessionTimeoutMinutes: 15,
  } as Settings;
}

/** Partially update settings with whitelisted fields and type checks. */
export async function updateSettingsPartial(
  req: ReqLike,
  patch: Partial<Settings>
): Promise<Settings> {
  const current = await loadSettings(req);
  const next: Settings = { ...current };
  if (typeof patch.virtualRoot === 'string') next.virtualRoot = patch.virtualRoot;
  if (Array.isArray(patch.apiConfigs)) next.apiConfigs = patch.apiConfigs as any;
  if (patch.signatures && typeof patch.signatures === 'object') next.signatures = patch.signatures as any;
  if (typeof patch.fetcherAutoStart === 'boolean') next.fetcherAutoStart = patch.fetcherAutoStart;
  if (typeof patch.sessionTimeoutMinutes === 'number') next.sessionTimeoutMinutes = patch.sessionTimeoutMinutes;
  await saveSettings(next, req);
  return next;
}
