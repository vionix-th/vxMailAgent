import React, { useState, useEffect } from 'react';
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, Grid, Card, CardHeader, CardContent, CardActions as MUICardActions, Avatar, IconButton, Tooltip, Chip, Divider, Stack, MenuItem, Select, InputLabel, FormControl, Alert, Paper } from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScienceIcon from '@mui/icons-material/Science';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { Account } from '../../shared/types';
import FetcherControl from './FetcherControl';
import { useTranslation } from 'react-i18next';
import { apiFetch } from './utils/http';

export default function Accounts({ showFetcher = true }: { showFetcher?: boolean }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<'gmail' | 'outlook'>('gmail');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reauthUrl, setReauthUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testProvider, setTestProvider] = useState<'gmail' | 'outlook' | null>(null);

  // Edit handler
  const handleEdit = (account: Account) => {
    setEditing(account);
  };

  // Save edit handler
  const handleSaveEdit = async () => {
    if (!editing) return;
    setLoading(true);
    setError(undefined);
    try {
      await apiFetch(`/api/accounts/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing)
      });
      setAccounts(accs => accs.map(a => a.id === editing.id ? editing : a));
      setEditing(null);
    } catch (e: any) {
      setError(e.message || (t('accounts.errors.failedUpdate') as string));
    } finally {
      setLoading(false);
    }
  };

  const handleTestGmail = async (id: string) => {
    setTestProvider('gmail');
    setTestOpen(true);
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);
    try {
      const data = await apiFetch(`/api/accounts/${id}/gmail-test`);
      if (data.ok === false) {
        setTestError(data.error || (t('accounts.errors.testFailed') as string));
        if (data.reauthUrl) {
          setReauthUrl(data.reauthUrl);
        }
        return;
      }
      setTestResult(data);
    } catch (e: any) {
      setTestError(e.message || String(e));
    } finally {
      setTestLoading(false);
    }
  };

  const handleTestOutlook = async (id: string) => {
    setTestProvider('outlook');
    setTestOpen(true);
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);
    try {
      const data = await apiFetch(`/api/accounts/${id}/outlook-test`);
      if (data.ok === false) {
        setTestError(data.error || (t('accounts.errors.testFailed') as string));
        return;
      }
      setTestResult(data);
    } catch (e: any) {
      setTestError(e.message || String(e));
    } finally {
      setTestLoading(false);
    }
  };

  // Delete handler
  const handleDelete = async (id: string) => {
    setLoading(true);
    setError(undefined);
    try {
      await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
      await fetchAccounts();
    } catch (e: any) {
      setError(e.message || (t('accounts.errors.failedDelete') as string));
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await apiFetch('/api/accounts');
      const warn = data.headers.get('x-vx-mailagent-warning');
      if (warn) setError(warn);
      setAccounts(data);
    } catch (e: any) {
      setError(e.message || (t('accounts.errors.failedLoad') as string));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAccounts(); }, []);

  const refreshAccount = async (id: string) => {
    setLoading(true);
    setError(undefined);
    setReauthUrl(null);
    try {
      const data = await apiFetch(`/api/accounts/${id}/refresh`, { method: 'POST' });
      if (data.error) {
        let msg = data.error;
        if (data.reauthUrl) {
          setReauthUrl(data.reauthUrl);
          msg += ` ${t('accounts.messages.reauthRequired')}`;
        }
        throw new Error(msg);
      }
      await fetchAccounts();
    } catch (e: any) {
      setError(e.message || (t('accounts.errors.failedRefreshToken') as string));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const state = encodeURIComponent(JSON.stringify({ provider }));
      const endpoint = provider === 'gmail'
        ? `/api/accounts/oauth/google/initiate?state=${state}`
        : `/api/accounts/oauth/outlook/initiate?state=${state}`;
      const data = await apiFetch(endpoint);
      if (data.error) {
        throw new Error(data.error);
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message || (t('oauth.initiateFailed') as string));
      setLoading(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5">{t('nav.accounts')}</Typography>
        <Button variant="contained" color="primary" onClick={() => setOpen(true)}>{t('accounts.add')}</Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}
          action={reauthUrl ? (
            <Button color="inherit" size="small" onClick={() => { window.location.href = reauthUrl; }}>{t('accounts.reauth') || 'Re-auth account'}</Button>
          ) : error.includes('accounts') ? (
            <Button color="inherit" size="small" onClick={fetchAccounts}>{t('actions.retry')}</Button>
          ) : undefined}
        >{error}</Alert>
      )}

      {accounts.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body1" sx={{ mb: 1 }}>{t('accounts.empty')}</Typography>
            <Button variant="outlined" onClick={() => setOpen(true)}>{t('accounts.add')}</Button>
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Grid container spacing={2}>
          {accounts.filter(a => a && typeof a === 'object' && a.id).map((account) => {
            const avatarChar = (account.email || '?').charAt(0).toUpperCase();
            const providerColor = account.provider === 'gmail' ? 'error.main' : 'primary.main';
            const hasAccess = !!account.tokens?.accessToken;
            const hasRefresh = !!account.tokens?.refreshToken;
            const expiry = account.tokens?.expiry;
            let expiryLabel = expiry || (t('accounts.none') as string);
            let expiryColor: 'default' | 'success' | 'warning' | 'error' = 'default';
            if (expiry) {
              const d = new Date(expiry);
              if (!isNaN(d.getTime())) {
                const now = Date.now();
                if (d.getTime() < now) expiryColor = 'error';
                else if (d.getTime() - now < 1000 * 60 * 60 * 24) expiryColor = 'warning';
                else expiryColor = 'success';
                expiryLabel = d.toLocaleString();
              }
            }
            return (
              <Grid item xs={12} sm={6} md={4} lg={3} key={account.id}>
                <Card variant="outlined">
                  <CardHeader
                    avatar={<Avatar sx={{ bgcolor: providerColor }}>{avatarChar}</Avatar>}
                    title={<Typography variant="subtitle1" noWrap>{account.email}</Typography>}
                    subheader={<Typography variant="caption" color="text.secondary">{account.provider} • {account.id}</Typography>}
                  />
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Chip size="small" label={t('accounts.chips.provider', { provider: account.provider })} color={account.provider === 'gmail' ? 'error' : 'primary'} variant="outlined" />
                      <Chip size="small" label={hasAccess ? t('accounts.access.set') : t('accounts.access.missing')} color={hasAccess ? 'success' : 'error'} variant={hasAccess ? 'filled' : 'outlined'} />
                      <Chip size="small" label={hasRefresh ? t('accounts.refresh.set') : t('accounts.refresh.missing')} color={hasRefresh ? 'success' : 'error'} variant={hasRefresh ? 'filled' : 'outlined'} />
                      <Chip size="small" label={t('accounts.expiry', { label: expiryLabel })} color={expiryColor} variant="outlined" />
                    </Stack>
                    {account.signature && (
                      <Typography variant="body2" sx={{ mt: 1.5 }} color="text.secondary">
                        <strong>{t('accounts.signature')}:</strong> {account.signature}
                      </Typography>
                    )}
                  </CardContent>
                  <MUICardActions sx={{ justifyContent: 'flex-end' }}>
                    <Tooltip title={t('actions.edit') as string}>
                      <span>
                        <IconButton size="small" onClick={() => handleEdit(account)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('accounts.refreshToken') as string}>
                      <span>
                        <IconButton size="small" onClick={() => refreshAccount(account.id)}>
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    {account.provider === 'gmail' && (
                      <Tooltip title={t('accounts.testGmail') as string}>
                        <span>
                          <IconButton size="small" onClick={() => handleTestGmail(account.id)}>
                            <ScienceIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {account.provider === 'outlook' && (
                      <Tooltip title={t('accounts.testOutlook') as string}>
                        <span>
                          <IconButton size="small" onClick={() => handleTestOutlook(account.id)}>
                            <ScienceIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title={t('actions.delete') as string}>
                      <span>
                        <IconButton size="small" color="error" onClick={() => handleDelete(account.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </MUICardActions>
                </Card>
              </Grid>
            );
          })}
          </Grid>
        </Paper>
      )}
      {showFetcher && (
        <Box sx={{ mt: 3, mb: 4 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">{t('adminTabs.fetcher')}</Typography>
            <Tooltip title={t('results.refresh') as string}>
              <span>
                <IconButton size="small" onClick={fetchAccounts}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <FetcherControl />
        </Box>
      )}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{t('accounts.add')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="provider-label">{t('accounts.provider')}</InputLabel>
            <Select
              labelId="provider-label"
              value={provider}
              label={t('accounts.provider') as string}
              onChange={e => setProvider(e.target.value as 'gmail' | 'outlook')}
            >
              <MenuItem value="gmail">{t('accounts.gmail')}</MenuItem>
              <MenuItem value="outlook">{t('accounts.outlook')}</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('actions.cancel')}</Button>
          <Button onClick={handleAddAccount} disabled={loading} variant="contained">{t('accounts.continueWith', { provider: provider === 'gmail' ? t('accounts.gmail') : t('accounts.outlook') })}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog open={!!editing} onClose={() => setEditing(null)}>
        <DialogTitle>{t('accounts.editAccount')}</DialogTitle>
        <DialogContent>
          <div>{t('accounts.email')}: {editing?.email}</div>
          <div>{t('accounts.provider')}: {editing?.provider}</div>
          <div>{t('accounts.id')}: {editing?.id}</div>
          
          <InputLabel sx={{ mt: 2 }}>{t('accounts.signature')}</InputLabel>
          <textarea
            style={{ width: '100%', minHeight: 60 }}
            value={editing?.signature || ''}
            onChange={e => setEditing(editing ? { ...editing, signature: e.target.value } : null)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t('actions.cancel')}</Button>
          <Button onClick={handleSaveEdit} variant="contained" disabled={loading}>{t('actions.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Account Test Dialog (Gmail/Outlook) */}
      <Dialog open={testOpen} onClose={() => setTestOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t(testProvider === 'outlook' ? 'accounts.test.titleOutlook' : 'accounts.test.title')}</DialogTitle>
        <DialogContent dividers>
          {testLoading && <Typography>{t('accounts.test.testing')}</Typography>}
          {testError && <Alert severity="error">{testError}</Alert>}
          {testResult && !testError && (
            <Box>
              <Alert severity="success">{t('accounts.test.succeeded')}</Alert>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, marginTop: 12 }}>{JSON.stringify(testResult, null, 2)}</pre>
            </Box>
          )}
          {testResult && testError && (
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, marginTop: 12 }}>{JSON.stringify(testResult, null, 2)}</pre>
          )}
          {testResult?.authorizeUrl && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => { window.location.href = testResult.authorizeUrl; }}>{t('accounts.reauth') || 'Re-auth account'}</Button>}>
                {t('accounts.test.reauthNeeded') || 'Authorization has expired or is missing. Please re-authenticate this account.'}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestOpen(false)}>{t('actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
