import { randomUUID } from 'crypto';

/**
 * Generates a cryptographically secure UUID v4.
 * Uses Node.js crypto.randomUUID() for RFC 4122 compliant identifiers.
 */
export const newId = (): string => {
  // Generate RFC 4122 UUID v4 with 128 bits of entropy
  // Standard format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return randomUUID();
};

/** Returns the current time in ISO 8601 format. */
export const nowIso = (): string => new Date().toISOString();
