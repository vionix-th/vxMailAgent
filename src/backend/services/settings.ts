import logger from './logger';
import { RepositoryError } from './error-handler';
import { requireReq, requireUid, ReqLike, getSettingsRepo } from '../utils/repo-access';

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
export async function loadSettings(req?: ReqLike): Promise<Settings> {
  const ureq = requireReq(req);
  const repo = getSettingsRepo(ureq);
  const all = await repo.getAll();
  if (!Array.isArray(all) || all.length === 0) {
    throw new RepositoryError('Settings not initialized');
  }
  const settings = all[0];
  // Validate required shape — fail closed instead of synthesizing
  if (!settings || typeof settings !== 'object') {
    throw new RepositoryError('Invalid settings payload');
  }
  if (!Array.isArray(settings.apiConfigs)) {
    throw new RepositoryError('Invalid settings: apiConfigs');
  }
  for (const cfg of settings.apiConfigs as ApiConfig[]) {
    if (!cfg || typeof cfg !== 'object' || typeof cfg.id !== 'string' || typeof cfg.model !== 'string' || typeof cfg.name !== 'string') {
      throw new RepositoryError('Invalid settings: malformed apiConfig');
    }
    if (typeof cfg.apiKey !== 'string' || !cfg.apiKey) {
      throw new RepositoryError('Invalid settings: apiConfig.apiKey missing');
    }
  }
  if (typeof settings.fetcherAutoStart !== 'boolean') {
    throw new RepositoryError('Invalid settings: fetcherAutoStart');
  }
  if (typeof settings.sessionTimeoutMinutes !== 'number') {
    throw new RepositoryError('Invalid settings: sessionTimeoutMinutes');
  }
  logger.debug('Loaded settings', { uid: requireUid(ureq) });
  return settings;
}

/** Save settings to the per-user repository. */
export async function saveSettings(settings: Settings, req: ReqLike): Promise<void> {
  const ureq = requireReq(req);
  try {
    const repo = getSettingsRepo(ureq);
    settings.apiConfigs.forEach((cfg) => {
      if (typeof cfg.apiKey !== 'string' || !cfg.apiKey) {
        throw new RepositoryError('Cannot persist apiConfig without apiKey');
      }
    });
    await repo.setAll([settings]);
    logger.debug('Saved settings', { uid: requireUid(ureq) });
  } catch (e) {
    logger.error('Failed to save settings', { err: e });
    throw e;
  }
}

/** Partially update settings with whitelisted fields and type checks. */
export async function updateSettingsPartial(
  req: ReqLike,
  patch: Partial<Settings>
): Promise<Settings> {
  const current = await loadSettings(req);
  const next: Settings = { ...current };
  if (typeof patch.virtualRoot === 'string') next.virtualRoot = patch.virtualRoot;
  if (Array.isArray(patch.apiConfigs)) {
    // Accept only updates that preserve existing apiKeys.
    const incoming = patch.apiConfigs as Partial<ApiConfig>[];
    const merged: ApiConfig[] = incoming.map((cfg) => {
      if (!cfg || typeof cfg.id !== 'string') {
        throw new RepositoryError('Invalid settings patch: apiConfig id required');
      }
      const currentCfg = current.apiConfigs.find((c) => c.id === cfg.id);
      if (!currentCfg) {
        throw new RepositoryError(`Invalid settings patch: apiConfig ${cfg.id} not found`);
      }
      return {
        ...currentCfg,
        ...(typeof cfg.name === 'string' ? { name: cfg.name } : {}),
        ...(typeof cfg.model === 'string' ? { model: cfg.model } : {}),
        ...(typeof cfg.maxCompletionTokens === 'number' ? { maxCompletionTokens: cfg.maxCompletionTokens } : { maxCompletionTokens: currentCfg.maxCompletionTokens }),
      };
    });
    next.apiConfigs = merged;
  }
  if (patch.signatures && typeof patch.signatures === 'object') next.signatures = patch.signatures as any;
  if (typeof patch.fetcherAutoStart === 'boolean') next.fetcherAutoStart = patch.fetcherAutoStart;
  if (typeof patch.sessionTimeoutMinutes === 'number') next.sessionTimeoutMinutes = patch.sessionTimeoutMinutes;
  await saveSettings(next, req);
  return next;
}
