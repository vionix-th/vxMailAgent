import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';
import { getGoogleOAuthConfig } from '../../config';
import { ensureValidGoogleAccessToken } from '../../oauth/google';
import { google } from 'googleapis';
import { createEmailEnvelope } from '../../../shared/constructors';
import { ValidationError } from '../../services/error-handler';

export const gmailProvider: IMailProvider = {
  id: 'gmail',

  async ensureValidAccessToken(account: Account) {
    const cfg = getGoogleOAuthConfig();
    const result = await ensureValidGoogleAccessToken(
      account.tokens,
      cfg
    );
    return result;
  },

  async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
    const max = (opts?.max && opts.max > 0 ? opts.max : 10);
    const unread = (typeof opts?.unreadOnly === 'boolean' ? opts!.unreadOnly : true);
    const q = unread ? 'is:unread' : '';

    const cfg = getGoogleOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2Client.setCredentials({ access_token: account.tokens.accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: max, q });
    const items = Array.isArray(listRes.data.messages) ? listRes.data.messages : [];

    const envelopes: EmailEnvelope[] = [];
    for (const msg of items) {
      const msgRes = await gmail.users.messages.get({ userId: 'me', id: String(msg.id) });
      const headers = msgRes.data?.payload?.headers ?? [];
      const getHeader = (name: string): string | undefined => {
        const v = headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value;
        return typeof v === 'string' ? v : undefined;
      };
      const subject = getHeader('Subject');
      const from = getHeader('From');
      const to = getHeader('To');
      const cc = getHeader('Cc');
      const bcc = getHeader('Bcc');
      const date = getHeader('Date');
      const snippet = typeof msgRes.data?.snippet === 'string' ? msgRes.data.snippet : undefined;
      const bodies = extractGmailBodies(msgRes.data?.payload);
      const mid = (typeof msg.id === 'string' && msg.id) ? msg.id : (typeof msgRes.data?.id === 'string' ? msgRes.data.id : undefined);
      if (!mid) throw new Error('Gmail message missing id');
      const env = createEmailEnvelope({
        id: mid,
        subject,
        from,
        to,
        cc,
        bcc,
        date,
        snippet,
        ...bodies,
        attachments: [],
      });
      envelopes.push(env);
    }
    return envelopes;
  },
};

function extractGmailBodies(payload: any): { bodyPlain?: string; bodyHtml?: string } {
  const result: { bodyPlain?: string; bodyHtml?: string } = {};
  function walk(part: any) {
    if (!part) return;
    const rawMime = part.mimeType;
    if (typeof rawMime !== 'string' || !rawMime.trim()) {
      throw new ValidationError('gmail part missing mimeType', 'GMAIL_PART_MIME_MISSING');
    }
    const mimeType = rawMime.trim().toLowerCase();
    const bodyData = part.body?.data;
    if (bodyData) {
      const decoded = Buffer.from(bodyData, 'base64').toString('utf8');
      if (mimeType === 'text/plain' && !result.bodyPlain) result.bodyPlain = decoded;
      if (mimeType === 'text/html' && !result.bodyHtml) result.bodyHtml = decoded;
    }
    if (Array.isArray(part.parts)) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return result;
}

export default gmailProvider;
