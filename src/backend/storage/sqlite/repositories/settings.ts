import type { SettingsRow } from '../../../repository/core';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function assertArray(value: unknown, name: string): asserts value is any[] {
  if (!Array.isArray(value)) {
    throw new Error(`SettingsRepository: ${name} must be an array`);
  }
}

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`SettingsRepository: ${name} must be an object`);
  }
}

export class SettingsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async load(): Promise<SettingsRow | null> {
    return this.withConnection((db) => {
      const row = db.prepare(
        'SELECT virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes FROM settings WHERE id = 1'
      ).get() as any;
      if (!row) return null;

      const apiConfigsRaw = JSON.parse(row.api_configs_json);
      assertArray(apiConfigsRaw, 'apiConfigs');

      const signaturesRaw = JSON.parse(row.signatures_json);
      assertRecord(signaturesRaw, 'signatures');

      return {
        virtualRoot: row.virtual_root,
        apiConfigs: apiConfigsRaw,
        signatures: signaturesRaw as Record<string, string>,
        fetcherAutoStart: Boolean(row.fetcher_auto_start),
        sessionTimeoutMinutes: Number(row.session_timeout_minutes),
      } as SettingsRow;
    });
  }

  async save(settings: SettingsRow): Promise<void> {
    assertArray(settings.apiConfigs, 'apiConfigs');
    assertRecord(settings.signatures, 'signatures');
    if (typeof settings.fetcherAutoStart !== 'boolean') {
      throw new Error('SettingsRepository: fetcherAutoStart must be boolean');
    }
    if (typeof settings.sessionTimeoutMinutes !== 'number' || !Number.isFinite(settings.sessionTimeoutMinutes)) {
      throw new Error('SettingsRepository: sessionTimeoutMinutes must be a finite number');
    }
    await this.transaction((db) => {
      db.prepare(
        'REPLACE INTO settings (id, virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes) VALUES (1, @virtual_root, @api_configs_json, @signatures_json, @fetcher_auto_start, @session_timeout_minutes)'
      ).run({
        virtual_root: settings.virtualRoot,
        api_configs_json: stringify(settings.apiConfigs),
        signatures_json: stringify(settings.signatures),
        fetcher_auto_start: settings.fetcherAutoStart ? 1 : 0,
        session_timeout_minutes: settings.sessionTimeoutMinutes,
      });
      return undefined;
    });
  }

  async delete(): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM settings WHERE id = 1').run();
      return undefined;
    });
  }
}
