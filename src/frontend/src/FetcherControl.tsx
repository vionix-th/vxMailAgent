import React, { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography, Button, Alert, Snackbar, Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Tooltip, Stack, IconButton, TableContainer, Chip, TextField, Select, MenuItem, FormControl, InputLabel, Divider, Switch, FormControlLabel, Menu, MenuItem as MUIMenuItem, ListItemIcon, ListItemText } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { FetcherLogEntry, FetcherLogLevel, AccountProvider } from '../../shared/types';
import { useTranslation } from 'react-i18next';
import { useCookieState } from './hooks/useCookieState';

interface FetcherStatus {
  active: boolean;
  running?: boolean;
  lastRun: string | null;
  nextRun: string | null;
  accountStatus: Record<string, { lastRun: string | null; lastError: string | null }>;
}

const FetcherControl: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<FetcherStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  // Fetcher logs state
  const [entries, setEntries] = useState<FetcherLogEntry[]>([]);
  const [selected, setSelected] = useCookieState<Set<string>>(
    'vx_ui.fetcher.selectedIds',
    new Set<string>(),
    {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      serialize: (s) => JSON.stringify(Array.from(s)),
      deserialize: (raw) => {
        try { return new Set<string>(JSON.parse(raw)); } catch { return new Set<string>(); }
      },
    }
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // Auto-refresh toggle (persisted in cookie)
  const [autoRefresh, setAutoRefresh] = useCookieState<boolean>('vx_ui.fetcher.autoRefresh', true, { maxAge: 60 * 60 * 24 * 365 });
  // Copy feedback
  const [copyOpen, setCopyOpen] = useState<boolean>(false);
  // Menus
  const [logMenuAnchor, setLogMenuAnchor] = useState<null | HTMLElement>(null);
  const [logMenuEntry, setLogMenuEntry] = useState<FetcherLogEntry | null>(null);
  const [acctMenuAnchor, setAcctMenuAnchor] = useState<null | HTMLElement>(null);
  const [acctMenu, setAcctMenu] = useState<{ id: string; s: { lastRun: string | null; lastError: string | null } } | null>(null);
  // Filters
  const [levelFilter, setLevelFilter] = useState<FetcherLogLevel | 'all'>('all');
  const [providerFilter, setProviderFilter] = useState<AccountProvider | 'all'>('all');
  const [eventFilter, setEventFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [query, setQuery] = useState<string>('');

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/fetcher/status');
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
    } catch (e: any) {
      setError(e.message || String(e));
      setSnackbarOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const openLogMenu = (e: React.MouseEvent<HTMLElement>, entry: FetcherLogEntry) => {
    e.stopPropagation();
    setLogMenuAnchor(e.currentTarget);
    setLogMenuEntry(entry);
  };
  const closeLogMenu = () => { setLogMenuAnchor(null); setLogMenuEntry(null); };

  const openAcctMenu = (e: React.MouseEvent<HTMLElement>, id: string, s: { lastRun: string | null; lastError: string | null }) => {
    e.stopPropagation();
    setAcctMenuAnchor(e.currentTarget);
    setAcctMenu({ id, s });
  };
  const closeAcctMenu = () => { setAcctMenuAnchor(null); setAcctMenu(null); };

  const handleCopyAccountRow = async (id: string, s: { lastRun: string | null; lastError: string | null }) => {
    const payload = { type: 'accountStatus', accountId: id, lastRun: s.lastRun, lastError: s.lastError };
    const text = JSON.stringify(payload, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyOpen(true);
    } catch (e: any) {
      setError(t('fetcher.errors.copyFailed'));
      setSnackbarOpen(true);
    }
  };

  const handleCopyLog = async (entry: FetcherLogEntry) => {
    const text = JSON.stringify(entry, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyOpen(true);
    } catch (e: any) {
      setError(t('fetcher.errors.copyFailed'));
      setSnackbarOpen(true);
    }
  };

  const controlFetcher = async (action: 'start' | 'stop' | 'trigger') => {
    try {
      setLoading(true);
      setError(null);
      const endpoint = action === 'trigger' ? 'run' : action;
      const res = await fetch(`/api/fetcher/${endpoint}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || String(e));
      setSnackbarOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      // keep UI responsive; don't block status polling
      const res = await fetch('/api/fetcher/logs');
      if (!res.ok) throw new Error(await res.text());
      const data: FetcherLogEntry[] = await res.json();
      setEntries(data);
      // Preserve active selection by id
      const stillExists = data.find(e => e.id === activeId);
      setActiveId(stillExists ? (stillExists.id as string) : (data[0]?.id || null));
      // Drop selections that no longer exist (by id)
      setSelected(prev => new Set(Array.from(prev).filter(id => data.some(e => e.id === id))));
    } catch (e: any) {
      setError(e.message || String(e));
      setSnackbarOpen(true);
    }
  };

  const handleLogSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setActiveId(id);
  };

  const handleLogDelete = async (id: string, timestamp?: string) => {
    const ok = window.confirm(t('fetcher.confirm.deleteOne', { timestamp: timestamp || id }));
    if (!ok) return;
    try {
      const res = await fetch(`/api/fetcher/logs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await fetchLogs();
    } catch (e: any) {
      setError(t('fetcher.errors.deleteFailed'));
      setSnackbarOpen(true);
    }
  };

  const handleLogBulkDelete = async () => {
    if (!selected.size) return;
    const ok = window.confirm(t('fetcher.confirm.deleteSelected', { count: selected.size }));
    if (!ok) return;
    try {
      const res = await fetch('/api/fetcher/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      await fetchLogs();
    } catch (e: any) {
      setError(t('fetcher.errors.bulkDeleteFailed'));
      setSnackbarOpen(true);
    }
  };

  const handleLogDeleteActive = async () => {
    if (!activeId) return;
    const ts = entries.find(e => e.id === activeId)?.timestamp;
    await handleLogDelete(activeId, ts);
  };

  const handleLogDeleteAll = async () => {
    if (!entries.length) return;
    const ok = window.confirm(t('fetcher.confirm.deleteAll', { count: entries.length }));
    if (!ok) return;
    try {
      const res = await fetch('/api/fetcher/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: entries.map(e => e.id!).filter(Boolean) })
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      await fetchLogs();
    } catch (e: any) {
      setError(t('fetcher.errors.bulkDeleteFailed'));
      setSnackbarOpen(true);
    }
  };

  useEffect(() => {
    // Always fetch once on mount/toggle
    fetchStatus();
    fetchLogs();
    if (!autoRefresh) return; // disable timers when paused
    const intervalStatus = setInterval(fetchStatus, 5000);
    const intervalLogs = setInterval(fetchLogs, 7000);
    return () => { clearInterval(intervalStatus); clearInterval(intervalLogs); };
  }, [autoRefresh]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (levelFilter !== 'all' && e.level !== levelFilter) return false;
      if (providerFilter !== 'all' && e.provider !== providerFilter) return false;
      if (accountFilter && e.accountId && !e.accountId.toLowerCase().includes(accountFilter.toLowerCase())) return false;
      if (accountFilter && !e.accountId && accountFilter) return false;
      if (eventFilter && !e.event.toLowerCase().includes(eventFilter.toLowerCase())) return false;
      if (q) {
        const hay = `${e.message || ''} ${e.event} ${e.emailId || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, levelFilter, providerFilter, eventFilter, accountFilter, query]);

  const activeEntry = useMemo(() => filteredEntries.find(e => e.id === activeId) || filteredEntries[0] || null, [filteredEntries, activeId]);

  return (
    <Box sx={{ maxWidth: '100%', mx: 'auto', mt: 2 }}>
      <Paper variant="outlined" sx={{ p: 3, overflow: 'hidden' }}>
        <Typography variant="h5" gutterBottom>{t('fetcher.title')}</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {t('fetcher.subtitle')}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2">{t('fetcher.loading')}</Typography>
          </Box>
        )}
        {status && !loading ? (
          <>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
              <Typography>{t('fetcher.status')} </Typography>
              <Typography color={status.active ? 'success.main' : 'text.secondary'} fontWeight={600}>
                {status.active ? t('fetcher.active') : t('fetcher.stopped')}
              </Typography>
              {status.running ? (
                <Chip
                  size="small"
                  color="info"
                  label={t('fetcher.running')}
                  icon={<CircularProgress color="inherit" size={12} />}
                />
              ) : null}
              <Button
                variant="contained"
                color={status.active ? 'error' : 'success'}
                onClick={() => controlFetcher(status.active ? 'stop' : 'start')}
                disabled={loading}
                sx={{ minWidth: 90 }}
              >
                {status.active ? t('actions.stop') : t('actions.start')}
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={() => controlFetcher('trigger')}
                disabled={loading || !!status.running}
                sx={{ minWidth: 110 }}
              >{t('actions.triggerNow')}</Button>
            </Box>
            <Typography variant="body2" sx={{ mb: 1 }}>{t('fetcher.lastRun')} <span style={{ fontFamily: 'monospace' }}>{status.lastRun || t('fetcher.never')}</span></Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>{t('fetcher.nextRun')} <span style={{ fontFamily: 'monospace' }}>{status.nextRun || t('fetcher.na')}</span></Typography>
            <Typography variant="subtitle1" sx={{ mt: 2, mb: 1 }}>{t('fetcher.perAccount')}</Typography>
            <Table size="small" sx={{ mb: 1, tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 220 }}>{t('fetcher.table.accountId')}</TableCell>
                  <TableCell sx={{ width: 170 }}>{t('fetcher.table.lastRun')}</TableCell>
                  <TableCell sx={{ width: 280 }}>{t('fetcher.table.lastError')}</TableCell>
                  <TableCell sx={{ width: 56, textAlign: 'right' }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(status.accountStatus).map(([id, s]) => (
                  <TableRow key={id}>
                    <TableCell sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Tooltip title={id} placement="top" arrow>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {id}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Tooltip title={s.lastRun || t('fetcher.never')} placement="top" arrow>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.lastRun || t('fetcher.never')}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ color: s.lastError ? 'error.main' : undefined, fontFamily: 'monospace' }}>
                      {s.lastError ? (
                        <Tooltip title={s.lastError} placement="top" arrow>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.lastError}
                          </Typography>
                        </Tooltip>
                      ) : ''}
                    </TableCell>
                    <TableCell align="right" padding="checkbox" sx={{ verticalAlign: 'middle' }}>
                      <IconButton size="small" onClick={(ev) => openAcctMenu(ev, id, s)}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{t('fetcher.logs.title')}</Typography>
              <Stack direction="row" spacing={1}>
                <Tooltip title={t('fetcher.tooltips.refresh')}>
                  <span>
                    <IconButton size="small" onClick={fetchLogs} disabled={loading}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <FormControlLabel
                  control={<Switch checked={autoRefresh} onChange={(_, v) => setAutoRefresh(v)} size="small" />}
                  label={autoRefresh ? t('fetcher.autoRefreshOn') : t('fetcher.autoRefreshOff')}
                />
                <Tooltip title={t('fetcher.tooltips.deleteActive')}>
                  <span>
                    <IconButton size="small" color="error" onClick={handleLogDeleteActive} disabled={!activeId}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('fetcher.tooltips.deleteSelected')}>
                  <span>
                    <IconButton size="small" color="error" onClick={handleLogBulkDelete} disabled={!selected.size}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('fetcher.tooltips.deleteAll')}>
                  <span>
                    <IconButton size="small" color="error" onClick={handleLogDeleteAll} disabled={!entries.length}>
                      <DeleteSweepIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel id="level-filter-label">{t('fetcher.logs.filters.level')}</InputLabel>
                <Select labelId="level-filter-label" label={t('fetcher.logs.filters.level')} value={levelFilter} onChange={e => setLevelFilter(e.target.value as any)}>
                  <MenuItem value="all">{t('fetcher.logs.filters.all')}</MenuItem>
                  <MenuItem value="debug">debug</MenuItem>
                  <MenuItem value="info">info</MenuItem>
                  <MenuItem value="warn">warn</MenuItem>
                  <MenuItem value="error">error</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="provider-filter-label">{t('fetcher.logs.filters.provider')}</InputLabel>
                <Select labelId="provider-filter-label" label={t('fetcher.logs.filters.provider')} value={providerFilter} onChange={e => setProviderFilter(e.target.value as any)}>
                  <MenuItem value="all">{t('fetcher.logs.filters.all')}</MenuItem>
                  <MenuItem value="gmail">gmail</MenuItem>
                  <MenuItem value="outlook">outlook</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" label={t('fetcher.logs.filters.account')} value={accountFilter} onChange={e => setAccountFilter(e.target.value)} />
              <TextField size="small" label={t('fetcher.logs.filters.event')} value={eventFilter} onChange={e => setEventFilter(e.target.value)} />
              <TextField size="small" label={t('fetcher.logs.filters.search')} value={query} onChange={e => setQuery(e.target.value)} />
            </Stack>

            <TableContainer sx={{ mt: 1, overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <input
                        type="checkbox"
                        checked={!!filteredEntries.length && selected.size === filteredEntries.filter(e => e.id).length}
                        onChange={e => {
                          if (e.target.checked) setSelected(new Set(filteredEntries.map(e => e.id!).filter(Boolean)));
                          else setSelected(new Set());
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </TableCell>
                    <TableCell>{t('fetcher.logs.headers.timestamp')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.level')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.provider')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.account')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.event')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.message')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.email')}</TableCell>
                    <TableCell>{t('fetcher.logs.headers.count')}</TableCell>
                    <TableCell padding="checkbox" sx={{ width: 56 }} align="right"></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredEntries.map((e, idx) => (
                    <TableRow key={`${e.id || e.timestamp}-${idx}`} selected={!!e.id && selected.has(e.id)} hover onClick={() => e.id && setActiveId(e.id)} style={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox" onClick={ev => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!e.id && selected.has(e.id)}
                          onChange={() => e.id && handleLogSelect(e.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{e.timestamp}</TableCell>
                      <TableCell>
                        <Chip size="small" label={e.level} color={e.level === 'error' ? 'error' : e.level === 'warn' ? 'warning' : e.level === 'info' ? 'info' : 'default'} />
                      </TableCell>
                      <TableCell>{e.provider || ''}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{e.accountId || ''}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{e.event}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                          {e.message || ''}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{e.emailId || ''}</TableCell>
                      <TableCell>{typeof e.count === 'number' ? e.count : ''}</TableCell>
                      <TableCell padding="checkbox" onClick={(ev) => ev.stopPropagation()} sx={{ verticalAlign: 'middle' }} align="right">
                        <IconButton size="small" onClick={(ev) => openLogMenu(ev, e)}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {activeEntry && (
              <Box sx={{ mt: 2 }}>
                <Divider sx={{ mb: 2 }} />
                <Box sx={{ p: 2 }}>
                  <Typography variant="subtitle1" gutterBottom>{t('fetcher.logs.activeDetail')}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    <strong>{t('fetcher.logs.labels.timestamp')}</strong> <span style={{ fontFamily: 'monospace' }}>{activeEntry.timestamp}</span>
                    {' '}<strong>{t('fetcher.logs.labels.level')}</strong> {activeEntry.level}
                    {' '}<strong>{t('fetcher.logs.labels.event')}</strong> <span style={{ fontFamily: 'monospace' }}>{activeEntry.event}</span>
                  </Typography>
                  {activeEntry.message && (
                    <Typography variant="body2" sx={{ mb: 1 }}><strong>{t('fetcher.logs.labels.message')}</strong> {activeEntry.message}</Typography>
                  )}
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    <strong>{t('fetcher.logs.labels.provider')}</strong> {activeEntry.provider || ''} {' '}
                    <strong>{t('fetcher.logs.labels.account')}</strong> <span style={{ fontFamily: 'monospace' }}>{activeEntry.accountId || ''}</span> {' '}
                    <strong>{t('fetcher.logs.labels.email')}</strong> <span style={{ fontFamily: 'monospace' }}>{activeEntry.emailId || ''}</span> {' '}
                    <strong>{t('fetcher.logs.labels.count')}</strong> {typeof activeEntry.count === 'number' ? activeEntry.count : ''}
                  </Typography>
                  {activeEntry.detail && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>{t('fetcher.logs.detail')}</Typography>
                      <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(activeEntry.detail, null, 2)}</pre>
                    </Box>
                  )}
                </Box>
              </Box>
            )}
          </>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2">{t('fetcher.loading')}</Typography>
          </Box>
        )}
      </Paper>
      {/* Log row menu */}
      <Menu
        anchorEl={logMenuAnchor}
        open={Boolean(logMenuAnchor)}
        onClose={closeLogMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MUIMenuItem onClick={() => { if (logMenuEntry) handleCopyLog(logMenuEntry); closeLogMenu(); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('fetcher.logs.copyRow')}</ListItemText>
        </MUIMenuItem>
        <MUIMenuItem onClick={() => { if (logMenuEntry?.id) handleLogDelete(logMenuEntry.id, logMenuEntry.timestamp); closeLogMenu(); }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>{t('actions.delete')}</ListItemText>
        </MUIMenuItem>
      </Menu>
      {/* Account row menu */}
      <Menu
        anchorEl={acctMenuAnchor}
        open={Boolean(acctMenuAnchor)}
        onClose={closeAcctMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MUIMenuItem onClick={() => { if (acctMenu) handleCopyAccountRow(acctMenu.id, acctMenu.s); closeAcctMenu(); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('fetcher.logs.copyRow')}</ListItemText>
        </MUIMenuItem>
      </Menu>
      <Snackbar
        open={copyOpen}
        autoHideDuration={2000}
        onClose={() => setCopyOpen(false)}
        message={t('fetcher.copied')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      />
    </Box>
  );
};

export default FetcherControl;
