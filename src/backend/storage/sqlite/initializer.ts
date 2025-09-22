import fs from 'fs';
import path from 'path';
import type { BetterSqliteDatabase } from './types';

const PRIMARY_SCHEMA_DIR = path.resolve(__dirname, 'schema');
const FALLBACK_SCHEMA_DIR = path.resolve(__dirname, '../../../../storage/sqlite/schema');

function resolveSchemaPath(filename: string): string {
  const primary = path.join(PRIMARY_SCHEMA_DIR, filename);
  if (fs.existsSync(primary)) return primary;
  const fallback = path.join(FALLBACK_SCHEMA_DIR, filename);
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(`SQLite schema file not found: ${filename}`);
}

function loadSchema(filename: string): string {
  const target = resolveSchemaPath(filename);
  return fs.readFileSync(target, 'utf8');
}

function readUserVersion(db: BetterSqliteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined;
  if (!row) return 0;
  const value = row.user_version;
  return typeof value === 'number' ? value : Number(value || 0);
}

function applySchema(db: BetterSqliteDatabase, filename: string): void {
  const sql = loadSchema(filename);
  db.exec(sql);
  db.prepare('PRAGMA user_version = 1').run();
}

export function ensureSchema(db: BetterSqliteDatabase, kind: 'shared' | 'user'): void {
  const version = readUserVersion(db);
  if (version > 0) {
    return;
  }

  applySchema(db, kind === 'shared' ? 'system.sql' : 'per_user.sql');
}
