import logger from './logger';
import { RepositoryError } from './error-handler';
import { ensureContext, requireUid, getSettingsRepo, ContextInput } from '../utils/repo-access';
import { newId } from '../utils/id';

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
export async function loadSettings(req?: ContextInput): Promise<Settings> {
  const ctx = ensureContext(req);
  const repo = getSettingsRepo(ctx);
  const settings = await repo.load();
  if (!settings) {
    throw new RepositoryError('Settings not initialized', 'SETTINGS_NOT_INITIALIZED', 412);
  }
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
  logger.debug('Loaded settings', { uid: requireUid(ctx) });
  return settings;
}

/** Save settings to the per-user repository. */
export async function saveSettings(settings: Settings, req: ContextInput): Promise<void> {
  const ctx = ensureContext(req);
  try {
    const repo = getSettingsRepo(ctx);
    settings.apiConfigs.forEach((cfg) => {
      if (typeof cfg.apiKey !== 'string' || !cfg.apiKey) {
        throw new RepositoryError('Cannot persist apiConfig without apiKey');
      }
    });
    await repo.save(settings);
    logger.debug('Saved settings', { uid: requireUid(ctx) });
  } catch (e) {
    logger.error('Failed to save settings', { err: e });
    throw e;
  }
}

/** Partially update settings with whitelisted fields and type checks. */
export async function updateSettingsPartial(
  req: ContextInput,
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
      if (Object.prototype.hasOwnProperty.call(cfg, 'apiKey')) {
        throw new RepositoryError('Invalid settings patch: apiKey updates are not allowed');
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

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RepositoryError(`${field} is required`);
  }
  return value.trim();
}

function ensureOptionalMaxTokens(value: unknown, field: string): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RepositoryError(`${field} must be a positive number`);
  }
  return value;
}

function cloneApiConfig(cfg: ApiConfig): ApiConfig {
  return {
    id: cfg.id,
    name: cfg.name,
    model: cfg.model,
    apiKey: cfg.apiKey,
    provider: cfg.provider,
    ...(typeof cfg.maxCompletionTokens === 'number' ? { maxCompletionTokens: cfg.maxCompletionTokens } : {}),
  };
}

export interface ApiConfigCreateInput {
  id?: string;
  name: string;
  model: string;
  apiKey: string;
  provider?: string;
  maxCompletionTokens?: number;
}

export async function createApiConfig(req: ContextInput, input: ApiConfigCreateInput): Promise<ApiConfig> {
  const ctx = ensureContext(req);
  const settings = await loadSettings(ctx);

  const name = ensureNonEmptyString(input.name, 'apiConfig.name');
  const model = ensureNonEmptyString(input.model, 'apiConfig.model');
  const apiKey = ensureNonEmptyString(input.apiKey, 'apiConfig.apiKey');
  const provider = typeof input.provider === 'string' && input.provider.trim() ? input.provider.trim() : undefined;
  const maxCompletionTokens = ensureOptionalMaxTokens(input.maxCompletionTokens, 'apiConfig.maxCompletionTokens');

  const id = input.id ? ensureNonEmptyString(input.id, 'apiConfig.id') : newId();
  if (settings.apiConfigs.some((cfg) => cfg.id === id)) {
    throw new RepositoryError(`apiConfig ${id} already exists`);
  }

  const created: ApiConfig = {
    id,
    name,
    model,
    apiKey,
    ...(provider ? { provider } : {}),
    ...(typeof maxCompletionTokens === 'number' ? { maxCompletionTokens } : {}),
  };

  const next: Settings = {
    ...settings,
    apiConfigs: [...settings.apiConfigs, created].map(cloneApiConfig),
  };
  await saveSettings(next, ctx);
  return created;
}

export interface ApiConfigUpdateInput {
  name?: string;
  model?: string;
  apiKey?: string;
  provider?: string;
  maxCompletionTokens?: number | null;
}

export async function updateApiConfig(req: ContextInput, id: string, patch: ApiConfigUpdateInput): Promise<ApiConfig> {
  const ctx = ensureContext(req);
  const settings = await loadSettings(ctx);
  const cfg = settings.apiConfigs.find((c) => c.id === id);
  if (!cfg) {
    throw new RepositoryError(`apiConfig ${id} not found`);
  }

  const next: ApiConfig = cloneApiConfig(cfg);

  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    next.name = ensureNonEmptyString(patch.name, 'apiConfig.name');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
    next.model = ensureNonEmptyString(patch.model, 'apiConfig.model');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
    next.apiKey = ensureNonEmptyString(patch.apiKey, 'apiConfig.apiKey');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'provider')) {
    next.provider = typeof patch.provider === 'string' && patch.provider.trim() ? patch.provider.trim() : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxCompletionTokens')) {
    const val = patch.maxCompletionTokens;
    if (val === null) {
      delete next.maxCompletionTokens;
    } else {
      next.maxCompletionTokens = ensureOptionalMaxTokens(val, 'apiConfig.maxCompletionTokens');
    }
  }

  const updated: Settings = {
    ...settings,
    apiConfigs: settings.apiConfigs.map((existing) => (existing.id === id ? next : existing)),
  };
  await saveSettings(updated, ctx);
  return next;
}

export async function deleteApiConfig(req: ContextInput, id: string): Promise<void> {
  const ctx = ensureContext(req);
  const settings = await loadSettings(ctx);
  const exists = settings.apiConfigs.some((cfg) => cfg.id === id);
  if (!exists) {
    throw new RepositoryError(`apiConfig ${id} not found`);
  }
  const next: Settings = {
    ...settings,
    apiConfigs: settings.apiConfigs.filter((cfg) => cfg.id !== id),
  };
  await saveSettings(next, ctx);
}
