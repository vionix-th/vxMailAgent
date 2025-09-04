import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';

export function createMockMailProvider(id: Account['provider']): IMailProvider {
  return {
    id,
    async ensureValidAccessToken(account: Account) {
      const oneHour = new Date(Date.now() + 3600_000).toISOString();
      return {
        updated: false,
        accessToken: account.tokens?.accessToken || 'mock-token',
        expiry: account.tokens?.expiry || oneHour,
        refreshToken: account.tokens?.refreshToken || 'mock-refresh',
      };
    },
    async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
      // consume unused param to satisfy noUnusedParameters without altering behavior
      void account;
      const now = new Date().toISOString();
      const max = (opts?.max && opts.max > 0 ? opts.max : 1);
      const env: EmailEnvelope = {
        id: `mock-email-${Date.now()}`,
        subject: 'E2E TEST: mock provider subject',
        from: 'sender@example.com',
        date: now,
        snippet: 'This is a mock email for E2E testing',
        bodyPlain: 'Hello from mock provider.',
        bodyHtml: '<p>Hello from mock provider.</p>',
        attachments: [],
      } as any;
      return Array.from({ length: max }).map(() => ({ ...env, id: `mock-email-${Date.now()}` }));
    },
  };
}

