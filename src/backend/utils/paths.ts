import path from 'path';
import fs from 'fs';
import logger from '../services/logger';

// Global path helpers using DATA_DIR are intentionally omitted to avoid
// circular dependencies and to enforce per-user isolation only.

/**
 * Resolve the data directory for persistent storage. Uses
 * `VX_MAILAGENT_DATA_DIR` when set, otherwise probes common locations for
 * both source and compiled runtimes.
 */
export function resolveDataDir(): string {
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
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch (e) {
      // Probe errors are non-fatal; log at debug and continue.
      logger.debug('resolveDataDir probe failed for candidate', { candidate: p, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Fallback to the ts-node default
  return candidates[0];
}

/** Resolves a file path within the persistent data directory. */
export const dataPath = (name: string) => path.join(resolveDataDir(), name);

// Export DATA_DIR derived locally to satisfy scripts that import it
export const DATA_DIR = resolveDataDir();

// UID validation: allow either simple ids or provider-prefixed ids with a single colon.
// Each segment limited to safe characters and reasonable length.
const UID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates a user ID for filesystem safety.
 * @param uid - User ID to validate
 * @returns true if valid, false otherwise
 */
export function validateUid(uid: string): boolean {
  if (!uid || typeof uid !== 'string') return false;
  if (uid.length > 96) return false;
  const parts = uid.split(':');
  if (parts.length === 1) return UID_SEGMENT.test(parts[0]);
  if (parts.length === 2) return UID_SEGMENT.test(parts[0]) && UID_SEGMENT.test(parts[1]);
  return false;
}

/**
 * Gets the user's root directory with security checks.
 * @param uid - User ID (must be pre-validated)
 * @returns Absolute path to user's root directory
 * @throws Error if uid is invalid or path traversal detected
 */
export function userRoot(uid: string): string {
  if (!validateUid(uid)) {
    throw new Error(`Invalid uid: ${uid}`);
  }

  const baseDir = resolveDataDir();
  // Sanitize uid for filesystem path safety (e.g., replace ':' to remain cross-platform safe)
  const fsUid = uid.replace(/:/g, '_');
  const userDir = path.join(baseDir, 'users', fsUid);
  const resolved = path.resolve(userDir);
  const expectedPrefix = path.resolve(baseDir, 'users', fsUid);
  
  // Ensure the resolved path is exactly what we expect (no traversal)
  if (resolved !== expectedPrefix) {
    throw new Error(`Path traversal detected: ${uid}`);
  }
  
  return resolved;
}

/**
 * Checks if a path contains symlinks and validates containment.
 * @param targetPath - Path to check
 * @param containerPath - Expected container path
 * @returns true if safe, false if symlinks detected or outside container
 */
export function validatePathSafety(targetPath: string, containerPath: string): boolean {
  try {
    // 1) Resolve real paths for container and target (or target's parent if not existing)
    const containerAbs = path.resolve(containerPath);
    if (!fs.existsSync(containerAbs)) return false;
    const containerReal = fs.realpathSync(containerAbs);

    const targetAbs = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.normalize(path.join(containerReal, targetPath));

    const targetReal = fs.existsSync(targetAbs)
      ? fs.realpathSync(targetAbs)
      : path.join(fs.realpathSync(path.dirname(targetAbs)), path.basename(targetAbs));

    // 2) Strict containment check: target must resolve inside container real path
    const rel = path.relative(containerReal, targetReal);
    const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    return contained;
  } catch {
    return false;
  }
}

/**
 * Ensures a directory exists with secure permissions.
 * @param dirPath - Directory path to create
 */
export function ensureSecureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

/**
 * Per-user file paths interface
 */
export interface UserPaths {
  root: string;
  dbFile: string;
  logsDir: string;
}

/**
 * Creates all per-user file paths with security validation.
 * @param uid - User ID (must be valid)
 * @returns UserPaths object with all file paths
 * @throws Error if uid is invalid or paths are unsafe
 */
export function userPaths(uid: string): UserPaths {
  const root = userRoot(uid);
  const logsDir = path.join(root, 'logs');

  ensureSecureDir(root);
  ensureSecureDir(logsDir);

  const dbFile = path.join(root, 'user.sqlite3');
  const resolvedDb = path.resolve(dbFile);
  if (!validatePathSafety(resolvedDb, root)) {
    throw new Error(`Unsafe DB path detected: ${resolvedDb}`);
  }

  return { root, dbFile: resolvedDb, logsDir };
}
