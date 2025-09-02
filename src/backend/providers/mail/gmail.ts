import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '../../config';
import { ensureValidGoogleAccessToken, getGoogleOAuth2Client } from '../../oauth/google';
import { google } from 'googleapis';

export const gmailProvider: IMailProvider = {
  id: 'gmail',

  async ensureValidAccessToken(account: Account) {
    const result = await ensureValidGoogleAccessToken(
      account,
      GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET!,
      GOOGLE_REDIRECT_URI!,
    );
    return result;
  },

  async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
    const max = (opts?.max && opts.max > 0 ? opts.max : 10);
    const unread = (typeof opts?.unreadOnly === 'boolean' ? opts!.unreadOnly : true);
    const q = unread ? 'is:unread' : '';

    const oauth2Client = getGoogleOAuth2Client(
      GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET!,
      GOOGLE_REDIRECT_URI!,
    );
    oauth2Client.setCredentials({ access_token: account.tokens.accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: max, q });
    const items = Array.isArray(listRes.data.messages) ? listRes.data.messages : [];

    const envelopes: EmailEnvelope[] = [];
    for (const msg of items) {
      const msgRes = await gmail.users.messages.get({ userId: 'me', id: String(msg.id) });
      const headers = msgRes.data?.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      const subject: string = getHeader('Subject');
      const from: string = getHeader('From');
      const date: string = getHeader('Date');
      const snippet: string = msgRes.data?.snippet || '';
      const bodies = extractGmailBodies(msgRes.data?.payload);
      envelopes.push({
        id: String(msg.id || msgRes.data?.id),
        subject,
        from,
        date,
        snippet,
        bodyPlain: bodies.bodyPlain,
        bodyHtml: bodies.bodyHtml,
        attachments: [],
      });
    }
    return envelopes;
  },
};

function extractGmailBodies(payload: any): { bodyPlain?: string; bodyHtml?: string } {
  const result: { bodyPlain?: string; bodyHtml?: string } = {};
  function walk(part: any) {
    if (!part) return;
    const mimeType = part.mimeType || '';
    const bodyData = part.body?.data;
    if (bodyData) {
      const decoded = Buffer.from(bodyData, 'base64').toString('utf8');
      if (mimeType.toLowerCase() === 'text/plain' && !result.bodyPlain) result.bodyPlain = decoded;
      if (mimeType.toLowerCase() === 'text/html' && !result.bodyHtml) result.bodyHtml = decoded;
    }
    if (Array.isArray(part.parts)) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return result;
}

export default gmailProvider;
