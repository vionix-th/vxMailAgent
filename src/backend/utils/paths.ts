import path from 'path';
import fs from 'fs';

// Global path helpers using DATA_DIR are intentionally omitted to avoid
// circular dependencies and to enforce per-user isolation only.

/** Resolve base data directory without importing persistence to avoid cycles. */
function baseDataDir(): string {
  const envDir = process.env.VX_MAILAGENT_DATA_DIR;
  if (envDir && envDir.trim()) return path.resolve(envDir);
  // Fallbacks similar to persistence.ts but minimal to avoid import cycle
  // Prefer repo-level data relative to cwd when running via ts-node
  return path.resolve(process.cwd(), 'data');
}

/** Resolves a file path within the persistent data directory. */
export const dataPath = (name: string) => path.join(baseDataDir(), name);

// Export DATA_DIR derived locally to satisfy scripts that import it
export const DATA_DIR = baseDataDir();

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
  
  // The base data directory is resolved in persistence.ts. To avoid a
  // circular import, we resolve it here dynamically at runtime using the
  // same environment variable with a defensive fallback to process.cwd().
  const envDir = process.env.VX_MAILAGENT_DATA_DIR;
  const baseDir = envDir && envDir.trim()
    ? path.resolve(envDir)
    : path.resolve(process.cwd(), 'data');
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
    // Check if any component in the path is a symlink
    const segments = targetPath.split(path.sep);
    let currentPath = '';
    
    for (const segment of segments) {
      if (!segment) continue;
      currentPath = currentPath ? path.join(currentPath, segment) : segment;
      
      if (fs.existsSync(currentPath)) {
        const stats = fs.lstatSync(currentPath);
        if (stats.isSymbolicLink()) {
          return false; // Reject any symlinks
        }
      }
    }
    
    // Verify final path is contained within expected directory
    const realPath = fs.existsSync(targetPath) ? fs.realpathSync(targetPath) : path.resolve(targetPath);
    const realContainer = path.resolve(containerPath);
    
    return realPath.startsWith(realContainer + path.sep) || realPath === realContainer;
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
  accounts: string;
  settings: string;
  prompts: string;
  agents: string;
  directors: string;
  filters: string;
  templates: string;
  imprints: string;
  conversations: string;
  workspaceItems: string;
  memory: string;
  logs: {
    fetcher: string;
    orchestration: string;
    providerEvents: string;
    traces: string;
  };
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
  
  // Ensure directories exist with secure permissions
  ensureSecureDir(root);
  ensureSecureDir(logsDir);
  
  const paths: UserPaths = {
    root,
    accounts: path.join(root, 'accounts.json'),
    settings: path.join(root, 'settings.json'),
    prompts: path.join(root, 'prompts.json'),
    agents: path.join(root, 'agents.json'),
    directors: path.join(root, 'directors.json'),
    filters: path.join(root, 'filters.json'),
    templates: path.join(root, 'templates.json'),
    imprints: path.join(root, 'imprints.json'),
    conversations: path.join(root, 'conversations.json'),
    workspaceItems: path.join(root, 'workspaceItems.json'),
    memory: path.join(root, 'memory.json'),
    logs: {
      fetcher: path.join(logsDir, 'fetcher.json'),
      orchestration: path.join(logsDir, 'orchestration.json'),
      providerEvents: path.join(logsDir, 'provider-events.json'),
      traces: path.join(logsDir, 'traces.json'),
    },
  };
  
  // Validate all paths for safety
  for (const [key, value] of Object.entries(paths)) {
    if (key === 'logs') {
      for (const logPath of Object.values(value as any)) {
        if (!validatePathSafety(logPath as string, root)) {
          throw new Error(`Unsafe path detected for ${key}: ${logPath}`);
        }
      }
    } else if (key !== 'root') {
      if (!validatePathSafety(value as string, root)) {
        throw new Error(`Unsafe path detected for ${key}: ${value}`);
      }
    }
  }
  
  return paths;
}


// System-level JSON files (non user-isolated)
// Only users.json is allowed as global application data
export const USERS_FILE = dataPath('users.json');

