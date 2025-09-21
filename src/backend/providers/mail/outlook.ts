import { graphRequest } from '../../utils/graph';
import type { Account, EmailEnvelope } from '../../../shared/types';
import { createEmailEnvelope } from '../../../shared/constructors';
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
      const subject = typeof full?.subject === 'string' ? full.subject : undefined;
      const fromAddr = (full?.from?.emailAddress ?? {}) as any;
      const fromName = typeof fromAddr.name === 'string' ? fromAddr.name.trim() : undefined;
      const fromEmail = typeof fromAddr.address === 'string' ? fromAddr.address.trim() : undefined;
      const from = fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : undefined;
      const date = typeof full?.receivedDateTime === 'string' ? full.receivedDateTime : undefined;
      const snippet = typeof full?.bodyPreview === 'string' ? full.bodyPreview : undefined;
      const contentType = typeof full?.body?.contentType === 'string' ? full.body.contentType.toLowerCase() : undefined;
      const content = typeof full?.body?.content === 'string' ? full.body.content : undefined;
      const to = Array.isArray(full?.toRecipients)
        ? full.toRecipients
            .map((r: any) => {
              const nm = typeof r?.emailAddress?.name === 'string' ? r.emailAddress.name.trim() : undefined;
              const addr = typeof r?.emailAddress?.address === 'string' ? r.emailAddress.address.trim() : undefined;
              return addr ? (nm ? `${nm} <${addr}>` : addr) : undefined;
            })
            .filter(Boolean)
            .join(', ') || undefined
        : undefined;
      const cc = Array.isArray(full?.ccRecipients)
        ? full.ccRecipients
            .map((r: any) => {
              const nm = typeof r?.emailAddress?.name === 'string' ? r.emailAddress.name.trim() : undefined;
              const addr = typeof r?.emailAddress?.address === 'string' ? r.emailAddress.address.trim() : undefined;
              return addr ? (nm ? `${nm} <${addr}>` : addr) : undefined;
            })
            .filter(Boolean)
            .join(', ') || undefined
        : undefined;
      const bcc = Array.isArray(full?.bccRecipients)
        ? full.bccRecipients
            .map((r: any) => {
              const nm = typeof r?.emailAddress?.name === 'string' ? r.emailAddress.name.trim() : undefined;
              const addr = typeof r?.emailAddress?.address === 'string' ? r.emailAddress.address.trim() : undefined;
              return addr ? (nm ? `${nm} <${addr}>` : addr) : undefined;
            })
            .filter(Boolean)
            .join(', ') || undefined
        : undefined;

      const idCandidate1 = typeof full?.id === 'string' ? full.id : undefined;
      const idCandidate2 = typeof m?.id === 'string' ? m.id : undefined;
      const mid = idCandidate1 ?? idCandidate2;
      if (!mid) throw new Error('Outlook message missing id');

      const env = createEmailEnvelope({
        id: mid,
        subject,
        from,
        to,
        cc,
        bcc,
        date,
        snippet,
        ...(contentType === 'html' ? { bodyHtml: content } : { bodyPlain: content }),
        attachments: [],
      });
      envelopes.push(env);
    }
    return envelopes;
  },
};

export default outlookProvider;
