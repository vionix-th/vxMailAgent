import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VX_MAILAGENT_KEY, USER_MAX_FILE_SIZE_MB } from './config';
import { validatePathSafety } from './utils/paths';

/**
 * Resolve the data directory for persistent storage. Uses `VX_MAILAGENT_DATA_DIR`
 * when set, otherwise probes common locations for both source and compiled
 * runtimes.
 */
const resolveDataDir = (): string => {
  const envDir = process.env.VX_MAILAGENT_DATA_DIR;
  if (envDir && envDir.trim()) return path.resolve(envDir);
  const candidates = [
    // ts-node runtime (src/backend -> ../../data => repo/data)
    path.resolve(__dirname, '../../data'),
    // compiled runtime (dist/backend -> ../../../../data => repo/data)
    path.resolve(__dirname, '../../../../data'),
    // when launched with cwd at src/backend
    path.resolve(process.cwd(), '../../data'),
    // when launched with cwd at repo root
    path.resolve(process.cwd(), 'data'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p; } catch {}
  }
  // Fallback to the ts-node default
  return candidates[0];
};
export const DATA_DIR = resolveDataDir();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCODING = 'base64';

let warnPlaintext = false;

const getKey = (): Buffer | undefined => {
  const key = VX_MAILAGENT_KEY;
  if (!key || key.length !== 64) {
    if (!warnPlaintext) {
      console.warn('[WARN] VX_MAILAGENT_KEY unset or invalid; persistence will use PLAINTEXT mode.');
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
export function encryptAndPersist(obj: any, filePath: string, containerPath?: string) {
  // Security validation if container path provided
  if (containerPath && !validatePathSafety(filePath, containerPath)) {
    throw new Error(`Security violation: path ${filePath} is not safe relative to ${containerPath}`);
  }
  
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  
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
    // Write to temporary file with secure permissions
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    
    // Force write to disk
    const fd = fs.openSync(tmpPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    
    // Atomic rename
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
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
export function loadAndDecrypt(filePath: string, containerPath?: string): any {
  // Security validation if container path provided
  if (containerPath && !validatePathSafety(filePath, containerPath)) {
    throw new Error(`Security violation: path ${filePath} is not safe relative to ${containerPath}`);
  }
  
  const key = getKey();
  const payload = fs.readFileSync(filePath, { encoding: 'utf8' });
  
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
