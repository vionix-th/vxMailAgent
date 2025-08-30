import React, { useEffect } from 'react';
import { Alert, Button, Stack, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Utility to parse query string
function useQuery() {
  return new URLSearchParams(window.location.search);
}

// Try to decode a JWT without verifying signature to read payload fields
function decodeJwtPayload(token: string): any | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

// Local error shape that can be either a string or a structured object
type OAuthError =
  | string
  | (Partial<{
      message: string;
      error: string;
      error_description: string;
      error_uri: string;
      detail: unknown;
      stack: string;
    }> & { [k: string]: any });

export default function OAuthCallback() {
  const navigate = useNavigate();
  const query = useQuery();
  const { t } = useTranslation();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<OAuthError | null>(null);
  const [warning, setWarning] = React.useState<string | undefined>(undefined);

  const completeAuth = async () => {
    setLoading(true);
    setError(null);
    let provider = query.get('provider');
    const code = query.get('code');
    const state = query.get('state');
    let mode: string | undefined = undefined;
    if (state) {
      // 1) Try plain JSON state (legacy)
      try {
        const parsed = JSON.parse(state);
        if (parsed && parsed.provider) provider = parsed.provider;
        if (parsed && parsed.mode) mode = parsed.mode;
      } catch {
        // 2) Try JWT payload (new signed state)
        const payload = decodeJwtPayload(state);
        if (payload) {
          // If signed state embedded a JSON string under 's', parse it
          if (typeof payload.s === 'string') {
            try {
              const inner = JSON.parse(payload.s);
              if (inner && inner.provider) provider = inner.provider;
              if (inner && inner.mode) mode = inner.mode;
            } catch {}
          }
          // Infer provider/mode from payload 'p' when not present inside 's'
          if (!provider && typeof payload.p === 'string') {
            if (/outlook/i.test(payload.p)) provider = 'outlook';
            else if (/google/i.test(payload.p)) provider = 'gmail';
          }
          if (!mode && typeof payload.p === 'string' && /login/i.test(payload.p)) mode = 'login';
        }
      }
    }
    if (!code) {
      setError(t('oauth.missingProviderOrCode'));
      setLoading(false);
      return;
    }
    const isLoginGoogle = mode === 'login' && (!provider || provider === 'google' || provider === 'gmail');
    const endpoint = isLoginGoogle
      ? `/api/auth/google/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
      : (provider === 'gmail'
          ? `/api/accounts/oauth/google/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
          : `/api/accounts/oauth/outlook/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`);
    try {
      const res = await fetch(endpoint, { credentials: 'include' });
      // Surface backend warnings if present
      const warn = res.headers.get('x-vx-mailagent-warning');
      if (warn) setWarning(warn);
      if (!res.ok) {
        let msg = t('oauth.failed') as string;
        try { const data = await res.json(); if (data.error) msg = data.error; } catch {}
        throw new Error(msg);
      }
      // For account connect flows, backend persists accounts; no extra POST needed
      if (!isLoginGoogle) { await res.json(); }
      setLoading(false);
      navigate('/');
    } catch (e: any) {
      // Preserve structured error objects when available; otherwise store a string
      const structured = e && typeof e === 'object' ? e : undefined;
      const msg = !structured ? (e?.message || (t('oauth.failed') as string)) : undefined;
      setError(structured ?? msg ?? (t('oauth.failed') as string));
      setLoading(false);
    }
  };

  React.useEffect(() => { completeAuth(); /* eslint-disable-next-line */ }, []);

  if (loading) return <div>{t('oauth.completing')}</div>;
  return (
    <Box>
      {error && (
        <Alert severity="error" variant="outlined" sx={{ maxWidth: 560, mx: 'auto', mt: 4 }}>
          <Box sx={{ fontWeight: 700, fontSize: 18, mb: 1 }}>{t('oauth.errorTitle')}</Box>
          <Box sx={{ mb: 1 }}>
            {typeof error === 'object' && error !== null ? (
              <>
                {('message' in error) && (error as any).message && <div><b>{t('oauth.labels.message')}</b> {String((error as any).message)}</div>}
                {('error' in error) && (error as any).error && <div><b>{t('oauth.labels.error')}</b> {String((error as any).error)}</div>}
                {('error_description' in error) && (error as any).error_description && <div><b>{t('oauth.labels.description')}</b> {String((error as any).error_description)}</div>}
                {('error_uri' in error) && (error as any).error_uri && <div><b>{t('oauth.labels.moreInfo')}</b> <a href={String((error as any).error_uri)} target="_blank" rel="noopener noreferrer">{String((error as any).error_uri)}</a></div>}
                {('detail' in error) && (error as any).detail && (
                  <Box component="pre" sx={{ color: 'error.dark', fontSize: 12, my: 1, whiteSpace: 'pre-wrap' }}>{String((error as any).detail)}</Box>
                )}
                {('stack' in error) && (error as any).stack && (
                  <details style={{ margin: '8px 0' }}>
                    <summary>{t('oauth.labels.stack')}</summary>
                    <Box component="pre" sx={{ fontSize: 11, color: 'error.dark', whiteSpace: 'pre-wrap' }}>{String((error as any).stack)}</Box>
                  </details>
                )}
                {Object.entries(error as Record<string, any>).filter(([k]) => !['message','error','error_description','error_uri','detail','stack'].includes(k)).map(([k, v]) => (
                  <div key={k}><b>{k}:</b> {typeof v === 'string' ? v : JSON.stringify(v)}</div>
                ))}
              </>
            ) : (
              String(error)
            )}
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
            <Button color="error" variant="contained" onClick={() => navigate('/')}>{t('oauth.abort')}</Button>
            <Button color="primary" variant="contained" onClick={() => {
              const state = query.get('state') || '';
              const parsed = (() => { try { return state ? JSON.parse(state) : undefined; } catch { return undefined; } })();
              // Support JWT-signed state as well
              const payload = parsed ? undefined : (state ? decodeJwtPayload(state) : undefined);
              let provider = query.get('provider') || (parsed && parsed.provider) || undefined as string | undefined;
              let mode = (parsed && parsed.mode) || undefined as string | undefined;
              if (!provider && payload && typeof payload.p === 'string') {
                if (/outlook/i.test(payload.p)) provider = 'outlook';
                else if (/google/i.test(payload.p)) provider = 'gmail';
              }
              if (!mode && payload && typeof payload.p === 'string' && /login/i.test(payload.p)) mode = 'login';
              const isLoginGoogle = mode === 'login' && (!provider || provider === 'google' || provider === 'gmail');
              const endpoint = isLoginGoogle
                ? `/api/auth/google/initiate`
                : (provider === 'gmail'
                    ? `/api/accounts/oauth/google/initiate?state=${encodeURIComponent(state)}`
                    : `/api/accounts/oauth/outlook/initiate?state=${encodeURIComponent(state)}`);
              fetch(endpoint)
                .then(res => res.json())
                .then(({ url }) => { if (url) window.location.href = url; else setError(t('oauth.initiateFailed')); })
                .catch(() => setError(t('oauth.initiateFailed')));
            }}>{t('oauth.retry')}</Button>
          </Stack>
        </Alert>
      )}
      {warning && <Alert severity="warning" sx={{ mt: 2 }}>{warning}</Alert>}
      {!error && !warning && <div>{t('oauth.redirecting')}</div>}
    </Box>
  );
}
