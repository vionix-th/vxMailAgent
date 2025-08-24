import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Alert, Divider, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { ApiConfig } from '../../shared/types';
import { getCleanupStats, cleanupAll, cleanupFetcherLogs, cleanupOrchestrationLogs, cleanupConversations, cleanupProviderEvents, cleanupTraces, CleanupStats } from './utils/api';

interface SettingsData {
  virtualRoot?: string;
  apiConfigs?: ApiConfig[];
  sessionTimeoutMinutes?: number;
}

export default function Settings() {
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const { t } = useTranslation('common');

  const handleApiConfigTest = async (id: string) => {
    setTestLoading(true);
    setTestResult(null);
    setTestError(null);
    setTestOpen(true);
    try {
      const res = await fetch(`/api/test/apiconfig/${id}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setTestError(data.error || 'Test failed');
        setTestResult(data);
      } else {
        setTestResult(data);
      }
    } catch (e: any) {
      setTestError(e.message || String(e));
    } finally {
      setTestLoading(false);
    }
  };
  const [settings, setSettings] = useState<SettingsData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Cleanup state
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null);
  const [cleanupAllOpen, setCleanupAllOpen] = useState(false);
  const [cleanupIndividualOpen, setCleanupIndividualOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      getCleanupStats()
    ])
      .then(([settingsData, stats]) => {
        setSettings(settingsData);
        setCleanupStats(stats);
      })
      .catch(() => setError(t('settings.errors.failedLoad')))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (field: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings(s => ({ ...s, [field]: e.target.value }));
  };
  const handleChangeNumber = (field: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const num = v === '' ? undefined : Number(v);
    setSettings(s => ({ ...s, [field]: (Number.isFinite(num as number) ? (num as number) : undefined) }));
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(t('settings.errors.failedSave'));
      setSuccess(t('settings.messages.saved'));
    } catch (e: any) {
      setError(e.message || t('settings.errors.failedSave'));
    } finally {
      setLoading(false);
    }
  };

  // API Configs management handlers
  const [editingApiConfig, setEditingApiConfig] = useState<ApiConfig | null>(null);
  const [addingApiConfig, setAddingApiConfig] = useState(false);
  const [apiConfigDraft, setApiConfigDraft] = useState<ApiConfig>({ id: '', name: '', apiKey: '', model: '' });

  const handleApiConfigChange = (field: keyof ApiConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiConfigDraft(d => ({ ...d, [field]: e.target.value }));
  };
  const handleApiConfigChangeNumber = (field: keyof ApiConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const num = v === '' ? undefined : Number(v);
    setApiConfigDraft(d => ({ ...d, [field]: (Number.isFinite(num as number) ? (num as number) : undefined) as any }));
  };
  const handleApiConfigEdit = (cfg: ApiConfig) => {
    setEditingApiConfig(cfg);
    setAddingApiConfig(false);
    setApiConfigDraft(cfg);
  };
  const handleApiConfigDelete = async (id: string) => {
    const nextApiConfigs = (settings.apiConfigs || []).filter(c => c.id !== id);
    const nextSettings = { ...settings, apiConfigs: nextApiConfigs };
    setSettings(nextSettings);
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (!res.ok) throw new Error(t('settings.errors.failedSave'));
      setSuccess(t('settings.apiConfigs.messages.deletedSaved'));
    } catch (e: any) {
      setError(e.message || t('settings.errors.failedSave'));
    } finally {
      setLoading(false);
    }
  };
  const handleApiConfigAdd = () => {
    setAddingApiConfig(true);
    setEditingApiConfig(null);
    setApiConfigDraft({ id: '', name: '', apiKey: '', model: '' });
  };
  const handleApiConfigSave = async () => {
    let nextApiConfigs: ApiConfig[];
    if (editingApiConfig) {
      nextApiConfigs = (settings.apiConfigs || []).map(c => c.id === editingApiConfig.id ? apiConfigDraft : c);
    } else {
      nextApiConfigs = [...(settings.apiConfigs || []), { ...apiConfigDraft, id: Date.now().toString(36) + Math.random().toString(36).slice(2) }];
    }
    const nextSettings = { ...settings, apiConfigs: nextApiConfigs };
    setSettings(nextSettings);
    setEditingApiConfig(null);
    setAddingApiConfig(false);
    setApiConfigDraft({ id: '', name: '', apiKey: '', model: '' });
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (!res.ok) throw new Error(t('settings.errors.failedSave'));
      setSuccess(t('settings.apiConfigs.messages.savedUpdated'));
    } catch (e: any) {
      setError(e.message || t('settings.errors.failedSave'));
    } finally {
      setLoading(false);
    }
  };
  const handleApiConfigCancel = () => {
    setEditingApiConfig(null);
    setAddingApiConfig(false);
    setApiConfigDraft({ id: '', name: '', apiKey: '', model: '' });
  };

  // Unified cleanup handlers
  const refreshCleanupStats = async () => {
    try {
      const stats = await getCleanupStats();
      setCleanupStats(stats);
    } catch (e) {
      console.error('Failed to refresh cleanup stats:', e);
    }
  };

  const handleCleanupAll = async () => {
    setCleanupAllOpen(false);
    setError(null);
    setSuccess(null);
    setCleanupBusy(true);
    try {
      const result = await cleanupAll();
      setSuccess(`🧹 All logs purged: ${result.deleted.total} items deleted (${result.deleted.fetcherLogs} fetcher logs, ${result.deleted.orchestrationLogs} orchestration logs, ${result.deleted.conversations} conversations, ${result.deleted.providerEvents} provider events, ${result.deleted.traces} traces)`);
      await refreshCleanupStats();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCleanupBusy(false);
    }
  };

  const handleIndividualCleanup = async (type: 'fetcher-logs' | 'orchestration-logs' | 'conversations' | 'provider-events' | 'traces') => {
    setCleanupIndividualOpen(false);
    setError(null);
    setSuccess(null);
    setCleanupBusy(true);
    try {
      let result;
      switch (type) {
        case 'fetcher-logs':
          result = await cleanupFetcherLogs();
          break;
        case 'orchestration-logs':
          result = await cleanupOrchestrationLogs();
          break;
        case 'conversations':
          result = await cleanupConversations();
          break;
        case 'provider-events':
          result = await cleanupProviderEvents();
          break;
        case 'traces':
          result = await cleanupTraces();
          break;
      }
      setSuccess(result.message);
      await refreshCleanupStats();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCleanupBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>{t('settings.title')}</Typography>
        <Divider sx={{ mb: 2 }} />
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
        <TextField
          label={t('settings.form.virtualRoot')}
          value={settings.virtualRoot || ''}
          onChange={handleChange('virtualRoot')}
          fullWidth
          margin="normal"
        />
        <TextField
          label={t('settings.form.sessionTimeout')}
          type="number"
          value={typeof settings.sessionTimeoutMinutes === 'number' ? settings.sessionTimeoutMinutes : 15}
          onChange={handleChangeNumber('sessionTimeoutMinutes')}
          fullWidth
          margin="normal"
          inputProps={{ min: 1 }}
          helperText={t('settings.form.sessionTimeoutHelper')}
        />
        <Divider sx={{ my: 3 }} />
        <Typography variant="h6" gutterBottom>{t('settings.apiConfigs.title')}</Typography>
        {(settings.apiConfigs || []).length === 0 && (
          <Typography color="text.secondary">{t('settings.apiConfigs.empty')}</Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" size="small" onClick={handleApiConfigAdd}>{t('settings.apiConfigs.add')}</Button>
        </Box>
        {(settings.apiConfigs || []).map(cfg => (
          <Paper key={cfg.id} sx={{ p: 2, mb: 1, display: 'flex', alignItems: 'center', gap: 2 }} variant="outlined">
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">{cfg.name}</Typography>
              <Typography variant="body2" color="text.secondary">{t('settings.apiConfigs.labels.model')}: {cfg.model}</Typography>
              {typeof (cfg as any).maxCompletionTokens === 'number' && (
                <Typography variant="body2" color="text.secondary">{t('settings.apiConfigs.labels.maxTokens')}: {(cfg as any).maxCompletionTokens}</Typography>
              )}
              <Typography variant="body2" color="text.secondary">{t('settings.apiConfigs.labels.key')}: {cfg.apiKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : <em>{t('settings.apiConfigs.labels.notSet')}</em>}</Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => handleApiConfigEdit(cfg)}>{t('actions.edit')}</Button>
            <Button size="small" color="error" variant="outlined" onClick={() => handleApiConfigDelete(cfg.id)}>{t('actions.delete')}</Button>
            <Button size="small" variant="outlined" sx={{ ml: 1 }} onClick={() => handleApiConfigTest(cfg.id)}>{t('settings.apiConfigs.test.cta')}</Button>
          </Paper>
        ))}
        <Dialog open={testOpen} onClose={() => setTestOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>{t('settings.apiConfigs.test.title')}</DialogTitle>
          <DialogContent dividers>
            {testLoading && <Typography>{t('settings.apiConfigs.test.testing')}</Typography>}
            {testError && <Alert severity="error">{testError}</Alert>}
            {testResult && !testError && (
              <Box>
                <Alert severity="success">{t('settings.apiConfigs.test.succeeded')}</Alert>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, marginTop: 12 }}>{JSON.stringify(testResult, null, 2)}</pre>
              </Box>
            )}
            {testResult && testError && (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, marginTop: 12 }}>{JSON.stringify(testResult, null, 2)}</pre>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTestOpen(false)}>{t('actions.close')}</Button>
          </DialogActions>
        </Dialog>

        {(addingApiConfig || editingApiConfig !== null) && (
          <Paper sx={{ p: 2, mb: 2, mt: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }} variant="outlined">
          <Typography variant="subtitle1" gutterBottom>{editingApiConfig ? t('settings.apiConfigs.editTitle') : t('settings.apiConfigs.addTitle')}</Typography>
          <TextField label={t('settings.apiConfigs.fields.name')} value={apiConfigDraft.name} onChange={handleApiConfigChange('name')} fullWidth margin="normal" />
          <TextField label={t('settings.apiConfigs.fields.model')} value={apiConfigDraft.model} onChange={handleApiConfigChange('model')} fullWidth margin="normal" />
          <TextField label={t('settings.apiConfigs.fields.apiKey')} value={apiConfigDraft.apiKey} onChange={handleApiConfigChange('apiKey')} fullWidth margin="normal" type="password" autoComplete="off" />
          <TextField
            label={t('settings.apiConfigs.fields.maxOutputTokens')}
            type="number"
            value={typeof (apiConfigDraft as any).maxCompletionTokens === 'number' ? (apiConfigDraft as any).maxCompletionTokens : ''}
            onChange={handleApiConfigChangeNumber('maxCompletionTokens')}
            fullWidth
            margin="normal"
            inputProps={{ min: 1 }}
            helperText={t('settings.apiConfigs.fields.maxOutputTokensHelper')}
          />
          <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button variant="contained" size="small" onClick={handleApiConfigSave}>{t('actions.save')}</Button>
            <Button variant="outlined" size="small" onClick={handleApiConfigCancel}>{t('actions.cancel')}</Button>
          </Box>
          </Paper>
        )}
        <Divider sx={{ my: 3 }} />
        <Typography variant="h6" gutterBottom>🧹 System Cleanup</Typography>
        
        {cleanupStats && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2" gutterBottom>Current Data Usage</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 2 }}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary">{cleanupStats.fetcherLogs}</Typography>
                <Typography variant="caption">Fetcher Logs</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary">{cleanupStats.orchestrationLogs}</Typography>
                <Typography variant="caption">Orchestration</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary">{cleanupStats.conversations}</Typography>
                <Typography variant="caption">Conversations</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary">{cleanupStats.providerEvents}</Typography>
                <Typography variant="caption">LLM Events</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary">{cleanupStats.traces}</Typography>
                <Typography variant="caption">Traces</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', borderLeft: '1px solid', borderColor: 'divider', pl: 2 }}>
                <Typography variant="h5" color="error.main">{cleanupStats.total}</Typography>
                <Typography variant="caption"><strong>Total Items</strong></Typography>
              </Box>
            </Box>
          </Paper>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Button
            variant="contained"
            color="error"
            disabled={cleanupBusy || !cleanupStats?.total}
            onClick={() => setCleanupAllOpen(true)}
            sx={{ minWidth: 160 }}
          >
            🧹 Purge All Logs
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={cleanupBusy || !cleanupStats?.total}
            onClick={() => setCleanupIndividualOpen(true)}
          >
            Individual Cleanup
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={refreshCleanupStats}
            disabled={cleanupBusy}
          >
            Refresh Stats
          </Button>
        </Box>

        {/* Confirm: Purge All Logs */}
        <Dialog open={cleanupAllOpen} onClose={() => setCleanupAllOpen(false)}>
          <DialogTitle>🧹 Purge All System Logs</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              This will permanently delete ALL system logs and data:
            </Typography>
            {cleanupStats && (
              <Box sx={{ pl: 2 }}>
                <Typography variant="body2">• {cleanupStats.fetcherLogs} fetcher logs</Typography>
                <Typography variant="body2">• {cleanupStats.orchestrationLogs} orchestration logs</Typography>
                <Typography variant="body2">• {cleanupStats.conversations} conversations</Typography>
                <Typography variant="body2">• {cleanupStats.providerEvents} LLM provider events</Typography>
                <Typography variant="body2">• {cleanupStats.traces} diagnostic traces</Typography>
                <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                  <strong>Total: {cleanupStats.total} items</strong>
                </Typography>
              </Box>
            )}
            <Alert severity="warning" sx={{ mt: 2 }}>
              This action cannot be undone. All diagnostic data will be permanently lost.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCleanupAllOpen(false)} disabled={cleanupBusy}>Cancel</Button>
            <Button onClick={handleCleanupAll} color="error" variant="contained" disabled={cleanupBusy}>
              🧹 Purge All
            </Button>
          </DialogActions>
        </Dialog>

        {/* Individual Cleanup Options */}
        <Dialog open={cleanupIndividualOpen} onClose={() => setCleanupIndividualOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Individual Cleanup Options</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Choose specific log types to clean up:
            </Typography>
            {cleanupStats && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cleanupBusy || !cleanupStats.fetcherLogs}
                  onClick={() => handleIndividualCleanup('fetcher-logs')}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>Fetcher Logs</span>
                  <span>{cleanupStats.fetcherLogs} items</span>
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cleanupBusy || !cleanupStats.orchestrationLogs}
                  onClick={() => handleIndividualCleanup('orchestration-logs')}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>Orchestration Logs</span>
                  <span>{cleanupStats.orchestrationLogs} items</span>
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cleanupBusy || !cleanupStats.conversations}
                  onClick={() => handleIndividualCleanup('conversations')}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>Conversations</span>
                  <span>{cleanupStats.conversations} items</span>
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cleanupBusy || !cleanupStats.providerEvents}
                  onClick={() => handleIndividualCleanup('provider-events')}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>LLM Provider Events</span>
                  <span>{cleanupStats.providerEvents} items</span>
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cleanupBusy || !cleanupStats.traces}
                  onClick={() => handleIndividualCleanup('traces')}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>Diagnostic Traces</span>
                  <span>{cleanupStats.traces} items</span>
                </Button>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCleanupIndividualOpen(false)} disabled={cleanupBusy}>Close</Button>
          </DialogActions>
        </Dialog>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 4 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSave}
            disabled={loading || addingApiConfig || editingApiConfig !== null}
          >
            {t('settings.saveCta')}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
