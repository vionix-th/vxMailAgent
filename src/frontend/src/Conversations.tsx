import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  Button,
  Chip,
  Stack,
  Divider,
  IconButton,
  TextField,
  MenuItem,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ReactMarkdown from 'react-markdown';
import { ConversationThread, ConversationStatus, WorkspaceItem, Agent, Director } from '../../shared/types';
import { WORKSPACE_ITEM_TYPES, WorkspaceItemTypeUI } from './constants/workspace';
import { useTranslation } from 'react-i18next';

const isThreadFinalized = (t?: ConversationThread | null) => {
  if (!t) return false;
  if ((t as any).finalized === true) return true;
  const st = (t as any).status;
  return st === 'finalized';
};

// Infer a display kind for a WorkspaceItem (MIME/tags-first, mirrors Results.tsx)
const getItemKind = (it: WorkspaceItem): string => {
  const mt = String(it.mimeType || '').toLowerCase();
  const tags = Array.isArray(it.tags) ? it.tags.map(t => String(t).toLowerCase()) : [];
  if (tags.includes('draft_reply') || mt === 'application/vnd.ia.draft-reply+json' || mt === 'application/x-ia-draft-reply+json') return 'draft_reply';
  if (mt.startsWith('image/')) return 'image';
  if (tags.includes('error') || mt === 'application/vnd.ia.error+json') return 'error';
  if (mt.includes('markdown')) return 'markdown';
  if (mt.includes('html')) return 'html';
  if (mt.startsWith('text/')) return 'text';
  if (tags.includes('tool_output')) return 'tool_output';
  if (mt.includes('json')) return 'json';
  return 'file';
};

export default function Conversations() {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<ConversationThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ thread: ConversationThread; children?: ConversationThread[] } | null>(null);

  // Workspace UI state (display-only per design)

  // Filters removed: canonical conversations have no filtering or sorting in UI

  // Workspace wiring state
  const [wsItems, setWsItems] = useState<WorkspaceItem[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [newType, setNewType] = useState<WorkspaceItemTypeUI>('text');
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newData, setNewData] = useState('');
  const [newMimeType, setNewMimeType] = useState('');
  const [newEncoding, setNewEncoding] = useState<'utf8'|'base64'|'binary'|''>('');
  const [finalizing, setFinalizing] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [directors, setDirectors] = useState<Director[]>([]);
  const [busy, setBusy] = useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkspaceItem | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editData, setEditData] = useState('');
  const [editMimeType, setEditMimeType] = useState('');
  const [editEncoding, setEditEncoding] = useState<'utf8'|'base64'|'binary'|''>('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch conversations');
      setItems(json.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Load agents and directors for display names
    fetch('/api/agents').then(r => r.json()).then(setAgents).catch(() => {});
    fetch('/api/directors').then(r => r.json()).then(setDirectors).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No client-side filtering
  const displayItems = items;

  // selection removed; deletion UI mirrors diagnostics (active or all visible)

  async function deleteOne(id: string) {
    const ok = window.confirm(t('conversations.confirm.deleteOne', { id }));
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to delete conversation');
      setItems(prev => prev.filter(c => c.id !== id && c.parentId !== id));
      if (detail && (detail.thread.id === id || (detail.thread as any).parentId === id)) setDetail(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllVisible() {
    if (!items.length) return;
    const ok = window.confirm(t('conversations.confirm.deleteAll', { count: items.length }));
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      const ids = items.map(c => c.id);
      const res = await fetch('/api/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to delete conversations');
      const idSet = new Set(ids);
      setItems(prev => prev.filter(c => !idSet.has(c.id) && !(c.parentId && idSet.has(c.parentId as any))));
      if (detail && (idSet.has(detail.thread.id) || (detail.thread as any).parentId && idSet.has((detail.thread as any).parentId))) setDetail(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }
  

  async function viewDetail(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch conversation');
      setDetail({ thread: json });
      // After loading detail, refresh workspace items from canonical endpoint if director
      const thread = json;
      if (thread?.kind === 'director') {
        await loadWorkspaceItems(thread.id);
      } else {
        setWsItems(thread?.workspaceItems || []);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function refreshDetail() {
    if (!detail) return;
    await viewDetail(detail.thread.id);
  }

  async function loadWorkspaceItems(workspaceId: string) {
    setWsLoading(true);
    setWsError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/items`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch workspace items');
      setWsItems(json || []);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    } finally {
      setWsLoading(false);
    }
  }

  async function addWorkspaceItem() {
    if (!detail || detail.thread.kind !== 'director') return;
    try {
      const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel || undefined,
          description: newDescription || undefined,
          tags,
          mimeType: newMimeType || undefined,
          encoding: (newEncoding || undefined) as any,
          data: newData || undefined,
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to add item');
      setNewLabel('');
      setNewDescription('');
      setNewTags('');
      setNewData('');
      setNewMimeType('');
      setNewEncoding('');
      await loadWorkspaceItems(detail.thread.id);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    }
  }

  function openEdit(item: WorkspaceItem) {
    setEditTarget(item);
    setEditLabel((item as any).label || '');
    setEditDescription((item as any).description || '');
    setEditData((item as any).data || '');
    setEditMimeType(item.mimeType || '');
    setEditEncoding((item.encoding as any) || '');
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!detail || detail.thread.kind !== 'director' || !editTarget) return;
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(editTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: editTarget.revision ?? 1,
          label: editLabel || undefined,
          description: editDescription || undefined,
          mimeType: editMimeType || undefined,
          encoding: (editEncoding || undefined) as any,
          data: editData || undefined,
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to update item');
      setEditOpen(false);
      setEditTarget(null);
      await loadWorkspaceItems(detail.thread.id);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    }
  }

  // No status field in canonical WorkspaceItem; updates are metadata-only via saveEdit().

  async function deleteWorkspaceItem(item: WorkspaceItem, hard = false) {
    if (!detail || detail.thread.kind !== 'director') return;
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(item.id)}?hard=${hard}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to delete item');
      await loadWorkspaceItems(detail.thread.id);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    }
  }

  async function finalizeWorkspace() {
    if (!detail || detail.thread.kind !== 'director') return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/finalize`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to finalize workspace');
      await refreshDetail();
    } catch (e: any) {
      setWsError(e?.message || String(e));
    } finally {
      setFinalizing(false);
    }
  }

  // Deprecated orchestration delete handlers removed; canonical API has no delete.

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">{t('conversations.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title={t('conversations.tooltips.deleteActive')}>
            <span>
              <IconButton size="small" color="error" onClick={() => detail && deleteOne(detail.thread.id)} disabled={!detail || busy}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={`${t('conversations.tooltips.deleteAll')}${displayItems.length ? ` (${displayItems.length})` : ''}`}>
            <span>
              <IconButton size="small" color="error" onClick={deleteAllVisible} disabled={!displayItems.length || busy}>
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('conversations.tooltips.refresh')}>
            <span>
              <IconButton size="small" onClick={load} disabled={loading || busy}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Filter bar removed: canonical conversations list has no filtering/sorting */}

      <TableContainer sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('conversations.table.started')}</TableCell>
              <TableCell>{t('conversations.table.status')}</TableCell>
              <TableCell>{t('conversations.table.kind')}</TableCell>
              <TableCell>{t('conversations.table.director')}</TableCell>
              <TableCell>{t('conversations.table.agent')}</TableCell>
              <TableCell>{t('conversations.table.subject')}</TableCell>
              <TableCell align="right">{t('conversations.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {displayItems.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell><Typography variant="body2">{c.startedAt}</Typography></TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`conversations.filters.statusOptions.${c.status}` as any)}
                    color={
                      c.status === 'failed' ? 'error' :
                      isThreadFinalized(c) ? 'success' :
                      c.status === 'ongoing' ? 'warning' :
                      'success'
                    }
                  />
                </TableCell>
                <TableCell><Chip size="small" label={t(`conversations.filters.kindOptions.${c.kind}` as any)} /></TableCell>
                <TableCell>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">{directors.find(d => d.id === c.directorId)?.name || c.directorId}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{c.directorId}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  {c.agentId ? (
                    <Stack spacing={0.25}>
                      <Typography variant="body2">{agents.find(a => a.id === c.agentId)?.name || c.agentId}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{c.agentId}</Typography>
                    </Stack>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{c.email?.subject || '-'}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Tooltip title={t('conversations.tooltips.view')}>
                      <span>
                        <IconButton size="small" onClick={() => viewDetail(c.id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('actions.delete')}>
                      <span>
                        <IconButton size="small" color="error" onClick={() => deleteOne(c.id)} disabled={busy}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!displayItems.length && !loading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">{t('conversations.empty')}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {detail && (
        <>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6">{t('conversations.detail.title', { id: detail.thread.id })}</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                size="small"
                label={t(`conversations.filters.statusOptions.${detail.thread.status}` as any)}
                color={
                  detail.thread.status === 'failed' ? 'error' :
                  isThreadFinalized(detail.thread) ? 'success' :
                  detail.thread.status === 'ongoing' ? 'warning' :
                  'success'
                }
              />
              {detail.thread.kind === 'director' && !isThreadFinalized(detail.thread) && (
                <Button size="small" variant="contained" onClick={finalizeWorkspace} disabled={finalizing}>
                  {finalizing ? t('conversations.detail.finalizing') : t('conversations.detail.finalize')}
                </Button>
              )}
            </Stack>
          </Stack>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`conversations.filters.kindOptions.${detail.thread.kind}` as any)}
            {' '}• {t('conversations.table.director')}={directors.find(d => d.id === detail.thread.directorId)?.name || detail.thread.directorId} ({detail.thread.directorId})
            {' '}• {t('conversations.table.agent')}={detail.thread.agentId ? `${(agents.find(a => a.id === detail.thread.agentId)?.name || detail.thread.agentId)} (${detail.thread.agentId})` : '-'}
            {' '}• {t('conversations.table.started')}={detail.thread.startedAt}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {detail.thread.lastActiveAt ? `${t('conversations.detail.labels.lastActive')}=${detail.thread.lastActiveAt} • ` : ''}
            {detail.thread.endedAt ? `${t('conversations.detail.labels.endedAt')}=${detail.thread.endedAt}` : ''}
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle1" gutterBottom>{t('conversations.detail.transcript')}</Typography>
          <Box sx={{ maxHeight: 320, overflow: 'auto', p: 1, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            {detail.thread.messages.map((m, idx) => (
              <Box key={idx} sx={{ mb: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{m.role}</Typography>
                <Box sx={{ pl: 1 }}>
                  <ReactMarkdown>{String(m.content ?? '')}</ReactMarkdown>
                </Box>
              </Box>
            ))}
            {!detail.thread.messages.length && <Typography variant="body2" color="text.secondary">{t('conversations.detail.noMessages')}</Typography>}
          </Box>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" gutterBottom>{t('conversations.workspace.title')}</Typography>
          {wsError && <Alert severity="error" sx={{ mb: 1 }}>{wsError}</Alert>}
          {detail.thread.kind === 'director' && !isThreadFinalized(detail.thread) && (
            <Stack spacing={1} sx={{ mb: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField select size="small" label={t('conversations.workspace.add.type')} value={newType} onChange={(e) => setNewType(e.target.value as WorkspaceItemTypeUI)} sx={{ minWidth: 160 }}>
                  {WORKSPACE_ITEM_TYPES.map(ti => (
                    <MenuItem key={ti} value={ti}>{ti}</MenuItem>
                  ))}
                </TextField>
                <TextField size="small" label={t('conversations.workspace.add.label')} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} fullWidth />
                <TextField size="small" label={t('conversations.workspace.add.description')} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} sx={{ minWidth: 200 }} />
                <TextField size="small" label={t('conversations.workspace.add.tags')} value={newTags} onChange={(e) => setNewTags(e.target.value)} sx={{ minWidth: 200 }} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField size="small" label={t('conversations.workspace.add.data')} value={newData} onChange={(e) => setNewData(e.target.value)} sx={{ minWidth: 160 }} />
                <TextField size="small" label={t('conversations.workspace.add.mimeType')} value={newMimeType} onChange={(e) => setNewMimeType(e.target.value)} sx={{ minWidth: 160 }} />
                <TextField select size="small" label={t('conversations.workspace.add.encoding')} value={newEncoding} onChange={(e) => setNewEncoding(e.target.value as any)} sx={{ minWidth: 140 }}>
                  <MenuItem value="">{t('conversations.workspace.add.encodingNone')}</MenuItem>
                  <MenuItem value="utf8">utf8</MenuItem>
                  <MenuItem value="base64">base64</MenuItem>
                  <MenuItem value="binary">binary</MenuItem>
                </TextField>
                {/* URL/sizeBytes/filename removed in data-centric model */}
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" size="small" onClick={addWorkspaceItem} disabled={!newLabel.trim() && !newDescription.trim() && !newData.trim()}>{t('actions.add')}</Button>
                <Button variant="text" size="small" startIcon={<RefreshIcon />} onClick={() => loadWorkspaceItems(detail.thread.id)} disabled={wsLoading}>{t('conversations.workspace.add.refresh')}</Button>
              </Stack>
            </Stack>
          )}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('conversations.workspace.table.type')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.provenance')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.tags')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.preview')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.mime')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.revision')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.created')}</TableCell>
                  <TableCell>{t('conversations.workspace.table.updated')}</TableCell>
                  {detail.thread.kind === 'director' && <TableCell align="right">{t('conversations.workspace.table.actions')}</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {(detail.thread.kind === 'director' ? wsItems : (detail.thread.workspaceItems || [])).map((a: WorkspaceItem) => (
                  <TableRow key={a.id}>
                    <TableCell><Chip size="small" label={getItemKind(a)} /></TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{a.provenance?.by}{a.provenance?.agentId ? `:${a.provenance.agentId}` : ''}{a.provenance?.tool ? `/${a.provenance.tool}` : ''}</Typography>
                    </TableCell>
                    <TableCell>{(a.tags || []).map((tTag, i) => <Chip key={i} size="small" label={tTag} sx={{ mr: 0.5 }} />)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(() => {
                          const label = (a as any).label as any;
                          const desc = (a as any).description as any;
                          if (typeof label === 'string' && label.trim()) return label;
                          if (typeof desc === 'string' && desc.trim()) return desc;
                          const d = (a as any).data as any;
                          const enc = (a as any).encoding as any;
                          if (typeof d === 'string') {
                            try { return enc === 'base64' ? atob(d) : d; } catch { return d; }
                          }
                          return '';
                        })()}
                      </Typography>
                    </TableCell>
                    <TableCell><Typography variant="caption">{a.mimeType || '-'}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{a.revision ?? '-'}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{a.created}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{a.updated}</Typography></TableCell>
                    {detail.thread.kind === 'director' && (
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button size="small" onClick={() => openEdit(a)}>{t('actions.edit')}</Button>
                          <Button size="small" color="error" onClick={() => deleteWorkspaceItem(a, false)}>{t('actions.delete')}</Button>
                          <Button size="small" color="error" onClick={() => deleteWorkspaceItem(a, true)}>{t('conversations.workspace.hardDelete')}</Button>
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!(detail.thread.kind === 'director' ? wsItems : (detail.thread.workspaceItems || [])).length && (
                  <TableRow>
                    <TableCell colSpan={detail.thread.kind === 'director' ? 12 : 11}><Typography variant="body2" color="text.secondary">{t('conversations.workspace.empty')}</Typography></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Edit metadata dialog */}
          <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{t('conversations.workspace.editTitle')}</DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
              <Stack spacing={1} sx={{ mt: 1 }}>
                <TextField size="small" label={t('conversations.workspace.add.label')} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                <TextField size="small" label={t('conversations.workspace.add.description')} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                <TextField size="small" label={t('conversations.workspace.add.data')} value={editData} onChange={(e) => setEditData(e.target.value)} />
                <TextField size="small" label={t('conversations.workspace.add.mimeType')} value={editMimeType} onChange={(e) => setEditMimeType(e.target.value)} />
                <TextField select size="small" label={t('conversations.workspace.add.encoding')} value={editEncoding} onChange={(e) => setEditEncoding(e.target.value as any)}>
                  <MenuItem value="">{t('conversations.workspace.add.encodingNone')}</MenuItem>
                  <MenuItem value="utf8">utf8</MenuItem>
                  <MenuItem value="base64">base64</MenuItem>
                  <MenuItem value="binary">binary</MenuItem>
                </TextField>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditOpen(false)}>{t('actions.cancel')}</Button>
              <Button variant="contained" onClick={saveEdit}>{t('actions.save')}</Button>
            </DialogActions>
          </Dialog>

          {/* Diagnostics and child agent threads removed in canonical view */}
        </>
      )}
    </Paper>
  );
}
