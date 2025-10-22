import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';
import { createEmailEnvelope } from '../../../shared/constructors';
import { ValidationError } from '../../services/error-handler';

function ensureMockTokens(account: Account): { accessToken: string; refreshToken: string; expiry: string } {
  const tokens = account.tokens;
  if (!tokens || typeof tokens !== 'object') {
    throw new ValidationError('mock provider requires explicit tokens', 'MOCK_PROVIDER_MISSING_TOKENS', 400);
  }
  const accessToken = typeof tokens.accessToken === 'string' ? tokens.accessToken.trim() : '';
  const refreshToken = typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : '';
  const expiry = typeof tokens.expiry === 'string' ? tokens.expiry.trim() : '';
  if (!accessToken || !refreshToken || !expiry) {
    throw new ValidationError('mock provider requires explicit tokens', 'MOCK_PROVIDER_MISSING_TOKENS', 400);
  }
  if (Number.isNaN(Date.parse(expiry))) {
    throw new ValidationError('mock provider token expiry must be a valid ISO timestamp', 'MOCK_PROVIDER_INVALID_EXPIRY', 400);
  }
  return { accessToken, refreshToken, expiry };
}

export function createMockMailProvider(id: Account['provider']): IMailProvider {
  return {
    id,
    async ensureValidAccessToken(account: Account) {
      const tokens = ensureMockTokens(account);
      return {
        updated: false,
        accessToken: tokens.accessToken,
        expiry: tokens.expiry,
        refreshToken: tokens.refreshToken,
      };
    },
    async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
      // consume unused param to satisfy noUnusedParameters without altering behavior
      void account;
      const now = new Date().toISOString();
      const max = (opts?.max && opts.max > 0 ? opts.max : 1);
      const build = (): EmailEnvelope => createEmailEnvelope({
        id: `mock-email-${Date.now()}`,
        subject: 'E2E TEST: mock provider subject',
        from: 'sender@example.com',
        to: 'recipient@example.com',
        cc: 'manager@example.com',
        bcc: '',
        date: now,
        snippet: 'This is a mock email for E2E testing',
        bodyPlain: 'Hello from mock provider.',
        bodyHtml: '<p>Hello from mock provider.</p>',
        attachments: [],
      });
      return Array.from({ length: max }).map(() => build());
    },
  };
}
