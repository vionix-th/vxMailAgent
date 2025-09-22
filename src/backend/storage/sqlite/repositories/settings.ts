import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export interface SettingsRow {
  virtualRoot: string;
  apiConfigs: any[];
  signatures: Record<string, string>;
  fetcherAutoStart: boolean;
  sessionTimeoutMinutes: number;
  payload?: Record<string, unknown>;
}

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

  async getAll(): Promise<SettingsRow[]> {
    return this.withConnection((db) => {
      const row = db.prepare(
        'SELECT virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes, payload_json FROM settings WHERE id = 1'
      ).get() as any;
      if (!row) return [];

      const apiConfigsRaw = JSON.parse(row.api_configs_json);
      assertArray(apiConfigsRaw, 'apiConfigs');

      const signaturesRaw = JSON.parse(row.signatures_json);
      assertRecord(signaturesRaw, 'signatures');

      let payload: Record<string, unknown> | undefined;
      if (row.payload_json) {
        const parsed = JSON.parse(row.payload_json);
        if (parsed !== null) {
          assertRecord(parsed, 'payload');
          payload = parsed as Record<string, unknown>;
        }
      }

      return [
        {
          virtualRoot: row.virtual_root,
          apiConfigs: apiConfigsRaw,
          signatures: signaturesRaw as Record<string, string>,
          fetcherAutoStart: Boolean(row.fetcher_auto_start),
          sessionTimeoutMinutes: Number(row.session_timeout_minutes),
          ...(payload ? { payload } : {}),
        },
      ];
    });
  }

  async setAll(settings: SettingsRow[]): Promise<void> {
    await this.transaction((db) => {
      if (!settings.length) {
        db.prepare('DELETE FROM settings WHERE id = 1').run();
        return;
      }
      const s = settings[0];
      assertArray(s.apiConfigs, 'apiConfigs');
      assertRecord(s.signatures, 'signatures');
      if (typeof s.fetcherAutoStart !== 'boolean') {
        throw new Error('SettingsRepository: fetcherAutoStart must be boolean');
      }
      if (typeof s.sessionTimeoutMinutes !== 'number' || !Number.isFinite(s.sessionTimeoutMinutes)) {
        throw new Error('SettingsRepository: sessionTimeoutMinutes must be a number');
      }
      let payloadJson: string | null = null;
      if (s.payload !== undefined) {
        assertRecord(s.payload, 'payload');
        payloadJson = stringify(s.payload);
      }
      db.prepare(
        'REPLACE INTO settings (id, virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes, payload_json) VALUES (1, @virtual_root, @api_configs_json, @signatures_json, @fetcher_auto_start, @session_timeout_minutes, @payload_json)'
      ).run({
        virtual_root: s.virtualRoot,
        api_configs_json: stringify(s.apiConfigs),
        signatures_json: stringify(s.signatures),
        fetcher_auto_start: s.fetcherAutoStart ? 1 : 0,
        session_timeout_minutes: s.sessionTimeoutMinutes,
        payload_json: payloadJson,
      });
      return undefined;
    });
  }
}
