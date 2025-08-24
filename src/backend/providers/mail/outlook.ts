import { graphRequest } from '../../utils/graph';
import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';
import { OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET } from '../../config';

export const outlookProvider: IMailProvider = {
  id: 'outlook',

  async ensureValidAccessToken(account: Account) {
    // Defer to existing helper to keep behavior identical
    const { ensureValidOutlookAccessToken } = require('../../oauth-outlook-refresh');
    const result = await ensureValidOutlookAccessToken(
      account,
      OUTLOOK_CLIENT_ID!,
      OUTLOOK_CLIENT_SECRET!
    );
    return result;
  },

  async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
    const max = (opts?.max && opts.max > 0 ? opts.max : 10);
    const unread = (typeof opts?.unreadOnly === 'boolean' ? opts!.unreadOnly : true);
    const filter = unread ? 'isRead%20eq%20false' : 'true';

    const list = await graphRequest<{ value: any[] }>(
      `/v1.0/me/messages?$top=${max}&$filter=${filter}&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,bodyPreview`,
      account.tokens.accessToken
    );
    const messages = Array.isArray(list.value) ? list.value : [];

    const envelopes: EmailEnvelope[] = [];
    for (const m of messages) {
      const full = await graphRequest<any>(
        `/v1.0/me/messages/${encodeURIComponent(m.id)}?$select=id,subject,from,receivedDateTime,bodyPreview,body`,
        account.tokens.accessToken
      );
      const subject: string = String(full.subject || '');
      const fromAddr = full?.from?.emailAddress || {};
      const fromName = String(fromAddr.name || '').trim();
      const fromEmail = String(fromAddr.address || '').trim();
      const from: string = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
      const date: string = String(full.receivedDateTime || '');
      const snippet: string = String(full.bodyPreview || '');
      const contentType: string = String(full?.body?.contentType || '').toLowerCase();
      const content: string = String(full?.body?.content || '');

      const env: EmailEnvelope = {
        id: String(full.id || m.id),
        subject,
        from,
        date,
        snippet,
        bodyPlain: contentType === 'html' ? undefined : content,
        bodyHtml: contentType === 'html' ? content : undefined,
        attachments: [],
      };
      envelopes.push(env);
    }
    return envelopes;
  },
};

export default outlookProvider;
