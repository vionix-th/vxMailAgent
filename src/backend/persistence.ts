import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VX_MAILAGENT_KEY, USER_MAX_FILE_SIZE_MB } from './config';
import { validatePathSafety, resolveDataDir } from './utils/paths';
import { logger } from './services/logger';

export const DATA_DIR = resolveDataDir();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCODING = 'base64';

let warnPlaintext = false;

const getKey = (): Buffer | undefined => {
  const key = VX_MAILAGENT_KEY;
  if (!key || key.length !== 64) {
    if (!warnPlaintext) {
      logger.warn('VX_MAILAGENT_KEY unset or invalid; persistence will use PLAINTEXT mode.', { envVar: 'VX_MAILAGENT_KEY' });
      warnPlaintext = true;
    }
    return undefined;
  }
  return Buffer.from(key, 'hex');
};

/**
 * Encrypt an object with AES-256-GCM and write it to disk atomically.
 * @param obj - Object to persist
 * @param filePath - Target file path
 * @param containerPath - Optional container path for security validation
 */
export async function encryptAndPersist(obj: any, filePath: string, containerPath?: string): Promise<void> {
  // Security validation if container path provided
  if (containerPath && !validatePathSafety(filePath, containerPath)) {
    throw new Error(`Security violation: path ${filePath} is not safe relative to ${containerPath}`);
  }

  const dir = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch {}

  const key = getKey();
  let content: string;

  if (!key) {
    content = JSON.stringify(obj);
  } else {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const json = JSON.stringify(obj);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    content = Buffer.concat([iv, tag, encrypted]).toString(ENCODING);
  }

  // Size validation
  const maxSizeBytes = USER_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (Buffer.byteLength(content, 'utf8') > maxSizeBytes) {
    throw new Error(`File size exceeds limit of ${USER_MAX_FILE_SIZE_MB}MB`);
  }

  // Atomic write: tmp file + fsync + rename
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

  try {
    await fs.promises.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    const handle = await fs.promises.open(tmpPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {}
    throw error;
  }
}

/**
 * Load and decrypt a previously persisted object. Falls back to plaintext JSON
 * if encryption is not configured or decryption fails.
 * @param filePath - Path to file to load
 * @param containerPath - Optional container path for security validation
 */
export async function loadAndDecrypt(filePath: string, containerPath?: string): Promise<any> {
  // Security validation if container path provided
  if (containerPath && !validatePathSafety(filePath, containerPath)) {
    throw new Error(`Security violation: path ${filePath} is not safe relative to ${containerPath}`);
  }

  const key = getKey();
  const payload = await fs.promises.readFile(filePath, { encoding: 'utf8' });

  // Size validation
  const maxSizeBytes = USER_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (Buffer.byteLength(payload, 'utf8') > maxSizeBytes) {
    throw new Error(`File size exceeds limit of ${USER_MAX_FILE_SIZE_MB}MB`);
  }

  if (!key) {
    return JSON.parse(payload);
  }

  try {
    const buf = Buffer.from(payload, ENCODING);
    const iv = buf.slice(0, IV_LENGTH);
    const tag = buf.slice(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = buf.slice(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return JSON.parse(json);
  } catch {
    return JSON.parse(payload);
  }
}
