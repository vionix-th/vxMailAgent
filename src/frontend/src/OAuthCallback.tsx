import React, { useEffect } from 'react';
import { Alert, Button, Stack, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Utility to parse query string
function useQuery() {
  return new URLSearchParams(window.location.search);
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
      try {
        const parsed = JSON.parse(state);
        if (parsed && parsed.provider) provider = parsed.provider;
        if (parsed && parsed.mode) mode = parsed.mode;
      } catch {}
    }
    if (!provider || !code) {
      setError(t('oauth.missingProviderOrCode'));
      setLoading(false);
      return;
    }
    const isLoginGoogle = mode === 'login' && (provider === 'google' || provider === 'gmail');
    const endpoint = isLoginGoogle
      ? `/api/auth/google/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
      : (provider === 'gmail'
          ? `/api/oauth2/google/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
          : `/api/oauth2/outlook/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`);
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
      if (!isLoginGoogle) {
        const { account } = await res.json();
        if (!account || !account.id || !account.email) throw new Error(t('oauth.noAccount') as string);
        // Persist account for legacy provider connect flows
        const persistRes = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(account),
        });
        if (!persistRes.ok) {
          let msg = t('oauth.failedPersist') as string;
          try { const data = await persistRes.json(); if (data.error) msg = data.error; } catch {}
          throw new Error(msg);
        }
      }
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
              const provider = query.get('provider') || (parsed && parsed.provider) || 'gmail';
              const isLoginGoogle = parsed && parsed.mode === 'login' && (provider === 'google' || provider === 'gmail');
              const endpoint = isLoginGoogle
                ? `/api/auth/google/initiate`
                : (provider === 'gmail'
                    ? `/api/oauth2/google/initiate?state=${encodeURIComponent(state)}`
                    : `/api/oauth2/outlook/initiate?state=${encodeURIComponent(state)}`);
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
