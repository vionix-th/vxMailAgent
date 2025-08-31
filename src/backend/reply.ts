import { Reply } from '../shared/types';
import { logger } from './services/logger';

/**
 * Sends an email reply through the chosen provider.
 * This stub only logs the request and returns a success placeholder.
 */
export async function sendReply(
  reply: Reply,
  provider: 'gmail' | 'outlook',
  account: any,
): Promise<{ success: boolean; error?: string }> {
  logger.info('[REPLY] sendReply called', { reply, provider, account });
  return { success: true };
}
