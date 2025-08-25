import { ConversationThread } from '../../shared/types';

/** Returns true if the specified director conversation has been finalized. */
export function isDirectorFinalized(
  conversations: ConversationThread[],
  dirId: string
): boolean {
  const d = conversations.find(c => c.id === dirId && c.kind === 'director');
  return !!d && (d.finalized === true || (d as any).status === 'finalized');
}
