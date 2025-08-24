import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Paper, Chip, Select, MenuItem, InputLabel, FormControl, Stack, Tooltip, IconButton
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { useCookieState } from './hooks/useCookieState';

// Canonical MemoryEntry type (should match shared/types)
interface MemoryEntry {
  id: string;
  scope: 'global' | 'shared' | 'local';
  content: string;
  created: string;
  updated: string;
  tags?: string[];
  relatedEmailId?: string;
  owner?: string;
  metadata?: Record<string, any>;
}

const scopeOptions = [
  { value: 'global', label: 'Global' },
  { value: 'shared', label: 'Shared' },
  { value: 'local', label: 'Local' },
];

export default function Memory() {
  const { t } = useTranslation('common');
  // State for agents, directors, accounts
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [directors, setDirectors] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; email: string }[]>([]);

  // Fetch all entities on mount
  useEffect(() => {
    fetchMemory();
    fetch('/api/agents').then(r => r.json()).then(setAgents).catch(() => {});
    fetch('/api/directors').then(r => r.json()).then(setDirectors).catch(() => {});
    fetch('/api/accounts').then(r => r.json()).then(setAccounts).catch(() => {});
  }, []);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'global' | 'shared' | 'local' | ''>('');
  const [ownerFilter, setOwnerFilter] = useState<string>('');
  const [ownerTypeFilter, setOwnerTypeFilter] = useState<'agent' | 'director' | 'user' | ''>('');
  const [selected, setSelected] = useCookieState<string[]>(
    'vx_ui.memory.selected',
    [],
    { maxAge: 60 * 60 * 24 * 7 }
  );

  const allSelected = useMemo(() => entries.length > 0 && selected.length === entries.length, [entries, selected]);

  useEffect(() => {
    fetchMemory();
  }, []);

  // Prune selections that no longer exist after a data reload
  useEffect(() => {
    if (!selected.length) return;
    const ids = new Set(entries.map(e => e.id));
    setSelected(prev => prev.filter(id => ids.has(id)));
  }, [entries]);

  const fetchMemory = () => {
    setLoading(true);
    fetch('/api/memory')
      .then(r => r.json())
      .then(setEntries)
      .catch(() => setError(t('memory.errors.failedLoad')))
      .finally(() => setLoading(false));
  };

  const handleSearch = () => {
    setLoading(true);
    let url = `/api/memory?query=${encodeURIComponent(search)}${scope ? `&scope=${scope}` : ''}`;
    if (ownerFilter) url += `&owner=${encodeURIComponent(ownerFilter)}`;
    if (ownerTypeFilter) url += `&ownerType=${encodeURIComponent(ownerTypeFilter)}`;
    fetch(url)
      .then(r => r.json())
      .then(setEntries)
      .catch(() => setError(t('memory.errors.searchFailed')))
      .finally(() => setLoading(false));
  };

  const handleEdit = (entry: MemoryEntry) => {
    setEditing(entry);
    setOpen(true);
  };
  const handleAdd = () => {
    setEditing({ id: '', scope: 'global', content: '', created: '', updated: '', tags: [] });
    setOpen(true);
  };
  const deleteOne = (id: string) => {
    const ok = window.confirm(t('memory.confirm.deleteOne', { id }));
    if (!ok) return;
    fetch(`/api/memory/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        setSuccess(t('memory.messages.deleted'));
        setSelected(prev => prev.filter(x => x !== id));
        if (editing && editing.id === id) { setOpen(false); setEditing(null); }
        fetchMemory();
      })
      .catch(() => setError(t('memory.errors.deleteFailed')));
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    const ok = window.confirm(t('memory.confirm.deleteSelected', { count: selected.length }));
    if (!ok) return;
    fetch('/api/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selected })
    })
      .then(r => r.json())
      .then(() => { setSuccess(t('memory.messages.deleted')); setSelected([]); fetchMemory(); })
      .catch(() => setError(t('memory.errors.batchDeleteFailed')));
  };

  const deleteAllEntries = () => {
    if (!entries.length) return;
    const ok = window.confirm(t('memory.confirm.deleteAll', { count: entries.length }));
    if (!ok) return;
    fetch('/api/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: entries.map(e => e.id) })
    })
      .then(r => r.json())
      .then(() => { setSuccess(t('memory.messages.deletedAll')); setSelected([]); fetchMemory(); })
      .catch(() => setError(t('memory.errors.deleteAllFailed')));
  };
  const handleSave = () => {
    if (!editing) return;
    const method = editing.id ? 'PUT' : 'POST';
    const url = editing.id ? `/api/memory/${editing.id}` : '/api/memory';
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
      .then(r => r.json())
      .then(() => {
        setSuccess(t('memory.messages.saved'));
        setOpen(false);
        fetchMemory();
      })
      .catch(() => setError(t('memory.errors.saveFailed')));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">{t('memory.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title={t('memory.tooltips.refresh')}>
            <span>
              <IconButton size="small" onClick={fetchMemory} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('memory.tooltips.deleteSelected')}>
            <span>
              <IconButton size="small" color="error" onClick={deleteSelected} disabled={!selected.length}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('memory.tooltips.deleteAll')}>
            <span>
              <IconButton size="small" color="error" onClick={deleteAllEntries} disabled={!entries.length}>
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField label={t('memory.search')} value={search} onChange={e => setSearch(e.target.value)} size="small" />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>{t('memory.scopeLabel')}</InputLabel>
          <Select value={scope} label={t('memory.scopeLabel')} onChange={e => setScope(e.target.value as any)}>
            <MenuItem value="">{t('memory.ownerTypes.all')}</MenuItem>
            {scopeOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{t(`memory.scope.${opt.value}`)}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>{t('memory.ownerTypeLabel')}</InputLabel>
          <Select value={ownerTypeFilter} label={t('memory.ownerTypeLabel')} onChange={e => setOwnerTypeFilter(e.target.value as any)}>
            <MenuItem value="">{t('memory.ownerTypes.all')}</MenuItem>
            <MenuItem value="agent">{t('memory.ownerTypes.agent')}</MenuItem>
            <MenuItem value="director">{t('memory.ownerTypes.director')}</MenuItem>
            <MenuItem value="user">{t('memory.ownerTypes.user')}</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{t('memory.ownerLabel')}</InputLabel>
          <Select
            value={ownerFilter}
            label={t('memory.ownerLabel')}
            onChange={e => setOwnerFilter(e.target.value as any)}
            renderValue={val => {
              if (!val) return t('memory.ownerTypes.all');
              const agent = agents.find(a => a.id === val);
              if (agent) return t('memory.owner.agent', { name: agent.name });
              const director = directors.find(d => d.id === val);
              if (director) return t('memory.owner.director', { name: director.name });
              const account = accounts.find(a => a.id === val);
              if (account) return t('memory.owner.user', { email: account.email });
              return val;
            }}
          >
            <MenuItem value="">{t('memory.ownerTypes.all')}</MenuItem>
            {agents.map(a => <MenuItem key={a.id} value={a.id}>{t('memory.owner.agent', { name: a.name })}</MenuItem>)}
            {directors.map(d => <MenuItem key={d.id} value={d.id}>{t('memory.owner.director', { name: d.name })}</MenuItem>)}
            {accounts.map(u => <MenuItem key={u.id} value={u.id}>{t('memory.owner.user', { email: u.email })}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="contained" onClick={handleSearch}>{t('memory.search')}</Button>
        <Button variant="outlined" onClick={handleAdd}>{t('memory.add')}</Button>
      </Box>
      <TableContainer sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={24}>
                <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? entries.map(i => i.id) : [])} />
              </TableCell>
              <TableCell>{t('memory.table.scope')}</TableCell>
              <TableCell>{t('memory.table.content')}</TableCell>
              <TableCell>{t('memory.table.tags')}</TableCell>
              <TableCell>{t('memory.table.owner')}</TableCell>
              <TableCell>{t('memory.table.provenance')}</TableCell>
              <TableCell>{t('memory.table.created')}</TableCell>
              <TableCell>{t('memory.table.updated')}</TableCell>
              <TableCell align="right">{t('memory.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map(entry => (
              <TableRow key={entry.id} hover selected={selected.includes(entry.id)}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelected([...selected, entry.id]);
                      else setSelected(selected.filter(id => id !== entry.id));
                    }}
                  />
                </TableCell>
                <TableCell>{t(`memory.scope.${entry.scope}`)}</TableCell>
                <TableCell>{entry.content}</TableCell>
                <TableCell>{entry.tags && entry.tags.map(tag => <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />)}</TableCell>
                <TableCell>{(() => {
                  const agent = agents.find(a => a.id === entry.owner);
                  if (agent) return <Chip label={t('memory.owner.agent', { name: agent.name })} size="small" color="primary"/>;
                  const director = directors.find(d => d.id === entry.owner);
                  if (director) return <Chip label={t('memory.owner.director', { name: director.name })} size="small" color="secondary"/>;
                  const account = accounts.find(a => a.id === entry.owner);
                  if (account) return <Chip label={t('memory.owner.user', { email: account.email })} size="small" color="success"/>;
                  return entry.owner || '';
                })()}</TableCell>
                <TableCell>{(() => {
                  // Provenance: {scope, owner}
                  const prov = (entry as any).provenance;
                  if (!prov) return <Chip label={t('memory.table.unknown')} size="small" color="default"/>;
                  let ownerLabel = prov.owner as string;
                  const agent = agents.find(a => a.id === prov.owner);
                  if (agent) ownerLabel = t('memory.owner.agent', { name: agent.name });
                  const director = directors.find(d => d.id === prov.owner);
                  if (director) ownerLabel = t('memory.owner.director', { name: director.name });
                  const account = accounts.find(a => a.id === prov.owner);
                  if (account) ownerLabel = t('memory.owner.user', { email: account.email });
                  const scopeLabel = t(`memory.scope.${prov.scope}`);
                  return <Chip label={t('memory.provenanceFormat', { scope: scopeLabel, owner: ownerLabel })} size="small" color="info"/>;
                })()}</TableCell>
                <TableCell>{entry.created && new Date(entry.created).toLocaleString()}</TableCell>
                <TableCell>{entry.updated && new Date(entry.updated).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Tooltip title={t('memory.tooltips.edit')}>
                      <span>
                        <IconButton size="small" onClick={() => handleEdit(entry)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('memory.tooltips.delete')}>
                      <span>
                        <IconButton size="small" color="error" onClick={() => deleteOne(entry.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{editing?.id ? t('memory.dialog.editTitle') : t('memory.dialog.addTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 400 }}>
          <FormControl fullWidth>
            <InputLabel>{t('memory.scopeLabel')}</InputLabel>
            <Select value={editing?.scope || 'global'} label={t('memory.scopeLabel')} onChange={e => setEditing(editing ? { ...editing, scope: e.target.value as any } : null)}>
              {scopeOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{t(`memory.scope.${opt.value}`)}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label={t('memory.dialog.contentLabel')} value={editing?.content || ''} onChange={e => setEditing(editing ? { ...editing, content: e.target.value } : null)} fullWidth multiline minRows={2} />
          <TextField label={t('memory.dialog.tagsCommaLabel')} value={editing?.tags?.join(', ') || ''} onChange={e => setEditing(editing ? { ...editing, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } : null)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>{t('memory.ownerLabel')}</InputLabel>
            <Select
              value={editing?.owner || ''}
              label={t('memory.ownerLabel')}
              onChange={e => setEditing(editing ? { ...editing, owner: e.target.value } : null)}
              renderValue={val => {
                if (!val) return t('memory.owner.none');
                const agent = agents.find(a => a.id === val);
                if (agent) return t('memory.owner.agent', { name: agent.name });
                const director = directors.find(d => d.id === val);
                if (director) return t('memory.owner.director', { name: director.name });
                const account = accounts.find(a => a.id === val);
                if (account) return t('memory.owner.user', { email: account.email });
                return val;
              }}
            >
              <MenuItem value="">{t('memory.owner.none')}</MenuItem>
              {agents.map(a => <MenuItem key={a.id} value={a.id}>{t('memory.owner.agent', { name: a.name })}</MenuItem>)}
              {directors.map(d => <MenuItem key={d.id} value={d.id}>{t('memory.owner.director', { name: d.name })}</MenuItem>)}
              {accounts.map(u => <MenuItem key={u.id} value={u.id}>{t('memory.owner.user', { email: u.email })}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label={t('memory.dialog.relatedEmailId')} value={editing?.relatedEmailId || ''} onChange={e => setEditing(editing ? { ...editing, relatedEmailId: e.target.value } : null)} fullWidth />
          <TextField label={t('memory.dialog.metadataJson')} value={editing?.metadata ? JSON.stringify(editing.metadata, null, 2) : ''} onChange={e => {
            let val = e.target.value;
            try {
              const parsed = val ? JSON.parse(val) : undefined;
              setEditing(editing ? { ...editing, metadata: parsed } : null);
            } catch { /* ignore JSON parse errors */ }
          }} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('actions.cancel')}</Button>
          <Button onClick={handleSave} variant="contained">{t('actions.save')}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Paper>
  );
}
