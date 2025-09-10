import { graphRequest } from '../../utils/graph';
import type { Account, EmailEnvelope } from '../../../shared/types';
import type { IMailProvider, FetchOptions } from './base';
import { getOutlookOAuthConfig } from '../../config';
import { ensureValidOutlookAccessToken } from '../../oauth/outlook';

export const outlookProvider: IMailProvider = {
  id: 'outlook',

  async ensureValidAccessToken(account: Account) {
    const cfg = getOutlookOAuthConfig();
    const result = await ensureValidOutlookAccessToken(
      account.tokens,
      cfg
    );
    return result;
  },

  async fetchUnread(account: Account, opts?: FetchOptions): Promise<EmailEnvelope[]> {
    const max = (opts?.max && opts.max > 0 ? opts.max : 10);
    const unread = (typeof opts?.unreadOnly === 'boolean' ? opts!.unreadOnly : true);
    const filter = unread ? 'isRead%20eq%20false' : 'true';

    const list = await graphRequest<{ value: any[] }>(
      `/v1.0/me/messages?$top=${max}&$filter=${filter}&$orderby=receivedDateTime%20desc&$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview`,
      account.tokens.accessToken
    );
    const messages = Array.isArray(list.value) ? list.value : [];

    const envelopes: EmailEnvelope[] = [];
    for (const m of messages) {
      const full = await graphRequest<any>(
        `/v1.0/me/messages/${encodeURIComponent(m.id)}?$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,body`,
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
      const to: string = Array.isArray(full?.toRecipients)
        ? full.toRecipients.map((r: any) => (r?.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r?.emailAddress?.address || '')).filter(Boolean).join(', ')
        : '';
      const cc: string = Array.isArray(full?.ccRecipients)
        ? full.ccRecipients.map((r: any) => (r?.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r?.emailAddress?.address || '')).filter(Boolean).join(', ')
        : '';
      const bcc: string = Array.isArray(full?.bccRecipients)
        ? full.bccRecipients.map((r: any) => (r?.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r?.emailAddress?.address || '')).filter(Boolean).join(', ')
        : '';

      const mid = full.id || m.id;
      if (!mid) throw new Error('Outlook message missing id');
      const env: EmailEnvelope = {
        id: String(mid),
        subject,
        from,
        ...(to ? { to } : {}),
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        date,
        snippet,
        ...(contentType === 'html' ? { bodyHtml: content } : { bodyPlain: content }),
        attachments: [],
      } as EmailEnvelope;
      envelopes.push(env);
    }
    return envelopes;
  },
};

export default outlookProvider;
