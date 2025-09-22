import fs from 'fs';
import path from 'path';
import { ensureSecureDir, resolveDataDir, validateUid } from '../../utils/paths';

const SHARED_DB_FILENAME = 'system.sqlite3';
const USER_DB_FILENAME = 'user.sqlite3';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

export function sharedDatabasePath(): string {
  const dataDir = resolveDataDir();
  ensureDir(dataDir);
  return path.join(dataDir, SHARED_DB_FILENAME);
}

export function userDatabasePath(uid: string): { dbFile: string; rootDir: string } {
  if (!validateUid(uid)) {
    throw new Error(`Invalid uid: ${uid}`);
  }
  const dataDir = resolveDataDir();
  ensureDir(dataDir);
  const fsUid = uid.replace(/:/g, '_');
  const userRoot = path.join(dataDir, 'users', fsUid);
  ensureSecureDir(userRoot);
  const dbFile = path.join(userRoot, USER_DB_FILENAME);
  return { dbFile, rootDir: userRoot };
}

export const SQLITE_SHARED_FILENAME = SHARED_DB_FILENAME;
export const SQLITE_USER_FILENAME = USER_DB_FILENAME;
