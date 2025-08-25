import { Reply } from '../shared/types';

/**
 * Sends an email reply through the chosen provider.
 * Currently logs the request and returns a success placeholder.
 */
export async function sendReply(
  reply: Reply,
  provider: 'gmail' | 'outlook',
  account: any,
): Promise<{ success: boolean; error?: string }> {
  console.log('[REPLY] sendReply called', { reply, provider, account });
  return { success: true };
}
