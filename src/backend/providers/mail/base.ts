import type { Account, EmailEnvelope } from '../../../shared/types';

export type FetchOptions = {
  max?: number;
  unreadOnly?: boolean;
};

export interface IMailProvider {
  id: Account['provider'];
  ensureValidAccessToken(account: Account): Promise<{
    updated: boolean;
    accessToken: string;
    expiry: string;
    refreshToken: string;
    error?: string;
  }>;
  fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]>;
}
