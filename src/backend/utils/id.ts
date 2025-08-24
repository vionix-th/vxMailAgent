export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

export const nowIso = (): string => new Date().toISOString();
