import type { Attachment, EmailEnvelope, ProviderEvent, LLMProvider, Account, AccountProvider } from './types';

function assertNonEmptyString(name: string, v: unknown): string {
  if (typeof v !== 'string') throw new Error(`Invalid ${name}: expected string`);
  const s = v.trim();
  if (!s) throw new Error(`Invalid ${name}: empty`);
  return s;
}

function assertOptionalString(name: string, v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') throw new Error(`Invalid ${name}: expected string`);
  const s = v.trim();
  return s || undefined;
}

function assertIsoLikeDate(name: string, v: unknown): string {
  const s = assertNonEmptyString(name, v);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid ${name}: not parseable date`);
  return s;
}

function assertAttachments(v: unknown): Attachment[] | undefined {
  if (v == null) return undefined;
  if (!Array.isArray(v)) throw new Error('Invalid attachments: expected array');
  for (const a of v) {
    if (!a || typeof a !== 'object') throw new Error('Invalid attachment: expected object');
    const id = (a as any).id;
    const filename = (a as any).filename;
    const mimeType = (a as any).mimeType;
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid attachment.id');
    if (typeof filename !== 'string' || !filename.trim()) throw new Error('Invalid attachment.filename');
    if (typeof mimeType !== 'string' || !mimeType.trim()) throw new Error('Invalid attachment.mimeType');
  }
  return v as Attachment[];
}

/**
 * Validated constructor for EmailEnvelope domain object.
 * Enforces required fields and basic formatting without defaulting invariants.
 */
export function createEmailEnvelope(input: {
  id: unknown;
  subject: unknown;
  from: unknown;
  to: unknown;
  date: unknown;
  cc?: unknown;
  bcc?: unknown;
  snippet?: unknown;
  bodyPlain?: unknown;
  bodyHtml?: unknown;
  attachments?: unknown;
}): EmailEnvelope {
  const id = assertNonEmptyString('id', input.id);
  const subject = assertNonEmptyString('subject', input.subject);
  const from = assertNonEmptyString('from', input.from);
  const to = assertNonEmptyString('to', input.to);
  const date = assertIsoLikeDate('date', input.date);

  const cc = assertOptionalString('cc', input.cc);
  const bcc = assertOptionalString('bcc', input.bcc);
  const snippet = assertOptionalString('snippet', input.snippet);
  const bodyPlain = assertOptionalString('bodyPlain', input.bodyPlain);
  const bodyHtml = assertOptionalString('bodyHtml', input.bodyHtml);
  const attachments = assertAttachments(input.attachments);

  const env: EmailEnvelope = {
    id,
    subject,
    from,
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    date,
    ...(snippet ? { snippet } : {}),
    ...(bodyPlain ? { bodyPlain } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    ...(attachments ? { attachments } : {}),
  };
  return env;
}

/** Merge two EmailEnvelope instances, preferring defined fields in `next` while preserving optionals from `prev`. */
export function mergeEmailEnvelope(prev: EmailEnvelope, next: EmailEnvelope): EmailEnvelope {
  // Required fields must come from `next` if present; fallback to prev otherwise
  const id = (typeof next.id === 'string' && next.id) ? next.id : prev.id;
  const subject = (typeof next.subject === 'string' && next.subject) ? next.subject : prev.subject;
  const from = (typeof next.from === 'string' && next.from) ? next.from : prev.from;
  const to = (typeof next.to === 'string' && next.to) ? next.to : prev.to;
  const date = (typeof next.date === 'string' && next.date) ? next.date : prev.date;

  return createEmailEnvelope({
    id,
    subject,
    from,
    to,
    date,
    cc: typeof next.cc === 'string' ? next.cc : prev.cc,
    bcc: typeof next.bcc === 'string' ? next.bcc : prev.bcc,
    snippet: typeof next.snippet === 'string' ? next.snippet : prev.snippet,
    bodyPlain: typeof next.bodyPlain === 'string' ? next.bodyPlain : prev.bodyPlain,
    bodyHtml: typeof next.bodyHtml === 'string' ? next.bodyHtml : prev.bodyHtml,
    attachments: Array.isArray(next.attachments) ? next.attachments : prev.attachments,
  });
}

/**
 * Validated constructor for ProviderEvent domain object.
 */
export function createProviderEvent(input: {
  id: unknown;
  conversationId: unknown;
  provider: unknown;
  type: unknown;
  timestamp: unknown;
  latencyMs?: unknown;
  usage?: unknown;
  payload?: unknown;
  error?: unknown;
}): ProviderEvent {
  const id = assertNonEmptyString('id', input.id);
  const conversationId = assertNonEmptyString('conversationId', input.conversationId);
  const provider = assertNonEmptyString('provider', input.provider) as LLMProvider;
  if (provider !== 'openai') throw new Error('Invalid provider');
  const type = assertNonEmptyString('type', input.type);
  if (type !== 'request' && type !== 'response' && type !== 'error') throw new Error('Invalid type');
  const timestamp = assertIsoLikeDate('timestamp', input.timestamp);

  const out: ProviderEvent = {
    id,
    conversationId,
    provider,
    type: type as ProviderEvent['type'],
    timestamp,
  };

  if (typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)) {
    out.latencyMs = input.latencyMs;
  }
  if (input.usage && typeof input.usage === 'object') {
    const u: any = input.usage;
    out.usage = {
      ...(typeof u.promptTokens === 'number' ? { promptTokens: u.promptTokens } : {}),
      ...(typeof u.completionTokens === 'number' ? { completionTokens: u.completionTokens } : {}),
      ...(typeof u.totalTokens === 'number' ? { totalTokens: u.totalTokens } : {}),
    };
  }
  if (input.payload !== undefined) out.payload = input.payload as any;
  if (typeof input.error === 'string') out.error = input.error;
  return out;
}

/** Validated constructor for Account domain object. */
export function createAccount(input: {
  id: unknown;
  provider: unknown;
  email: unknown;
  signature: unknown;
  tokens: unknown;
}): Account {
  const id = assertNonEmptyString('id', input.id);
  const provider = assertNonEmptyString('provider', input.provider) as AccountProvider;
  if (provider !== 'gmail' && provider !== 'outlook') throw new Error('Invalid provider');
  const email = assertNonEmptyString('email', input.email);
  // Signature may be empty string but must be present
  const signature = typeof input.signature === 'string' ? input.signature : (() => { throw new Error('Invalid signature'); })();

  if (!input.tokens || typeof input.tokens !== 'object') throw new Error('Invalid tokens');
  const tokens = input.tokens as any;
  const accessToken = assertNonEmptyString('tokens.accessToken', tokens.accessToken);
  const refreshToken = assertNonEmptyString('tokens.refreshToken', tokens.refreshToken);
  const expiry = assertIsoLikeDate('tokens.expiry', tokens.expiry);

  const acc: Account = {
    id,
    provider,
    email,
    signature,
    tokens: { accessToken, refreshToken, expiry },
  };
  return acc;
}
