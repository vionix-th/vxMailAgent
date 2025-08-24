import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VX_MAILAGENT_KEY } from './config';

// Persistent data directory
// Prefer VX_MAILAGENT_DATA_DIR; otherwise probe common locations so it works in both ts-node and compiled dist runtimes.
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

export function encryptAndPersist(obj: any, filePath: string) {
  const key = getKey();
  if (!key) {
    fs.writeFileSync(filePath, JSON.stringify(obj), { encoding: 'utf8' });
    return;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString(ENCODING);
  fs.writeFileSync(filePath, payload, { encoding: 'utf8' });
}

export function loadAndDecrypt(filePath: string): any {
  const key = getKey();
  const payload = fs.readFileSync(filePath, { encoding: 'utf8' });
  // If no key, or payload appears to be JSON, parse plaintext JSON
  if (!key) {
    return JSON.parse(payload);
  }
  // Try decrypt-first with the provided key
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
    // Fallback: tolerate legacy plaintext JSON files when key is now set
    return JSON.parse(payload);
  }
}
