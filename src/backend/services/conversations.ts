import { ConversationThread } from '../../shared/types';
import * as persistence from '../persistence';

export function minutesToMs(min: number): number {
  return Math.max(1, min) * 60 * 1000;
}

export function calcExpiresFrom(nowIso: string, sessionTimeoutMinutes: number): string {
  const nowMs = Date.parse(nowIso) || Date.now();
  const expires = new Date(nowMs + minutesToMs(Number(sessionTimeoutMinutes || 15)));
  return expires.toISOString();
}

export function isExpired(thread: ConversationThread): boolean {
  if (thread.status === 'expired') return true;
  if (!thread.expiresAt) return false;
  return Date.now() > Date.parse(thread.expiresAt);
}

export function bumpActivityById(
  id: string,
  conversations: ConversationThread[],
  filePath: string,
  sessionTimeoutMinutes: number,
): void {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return;
  const now = new Date().toISOString();
  const updated = { ...conversations[idx], lastActiveAt: now, expiresAt: calcExpiresFrom(now, sessionTimeoutMinutes) } as ConversationThread;
  conversations[idx] = updated;
  try { persistence.encryptAndPersist(conversations, filePath); } catch {}
}

export function markExpiredById(
  id: string,
  conversations: ConversationThread[],
  filePath: string,
  reason?: string,
): void {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return;
  const now = new Date().toISOString();
  const t = conversations[idx];
  conversations[idx] = { ...t, status: 'expired', endedAt: now, expiresAt: now } as ConversationThread;
  try { persistence.encryptAndPersist(conversations, filePath); } catch {}
  console.log(`[${now}] [LIFECYCLE] Expired session ${id}${reason ? `: ${reason}` : ''}`);
}

export function isDirectorFinalized(conversations: ConversationThread[], dirId: string): boolean {
  const d = conversations.find(c => c.id === dirId && c.kind === 'director');
  return !!d && (d.finalized === true || (d as any).status === 'finalized');
}

export function sweepExpiredSessions(
  conversations: ConversationThread[],
  filePath: string,
): number {
  const now = new Date().toISOString();
  let changed = 0;
  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i];
    if (c.kind === 'agent' && c.status === 'ongoing' && isExpired(c)) {
      conversations[i] = { ...c, status: 'expired', endedAt: now } as ConversationThread;
      changed++;
    }
  }
  if (changed) {
    try { persistence.encryptAndPersist(conversations, filePath); } catch {}
    console.log(`[${now}] [LIFECYCLE] Swept ${changed} expired agent sessions`);
  }
  return changed;
}
