/**
 * Generates a short random identifier based on the current time and randomness.
 */
export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

/** Returns the current time in ISO 8601 format. */
export const nowIso = (): string => new Date().toISOString();
