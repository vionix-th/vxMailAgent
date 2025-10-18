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
import { ConversationThread, ConversationStatus, WorkspaceItem, Agent, Director } from './types/shared';
import { WORKSPACE_ITEM_TYPES, WorkspaceItemTypeUI } from './constants/workspace';
import { useTranslation } from 'react-i18next';
import { apiFetch } from './utils/http';

// Infer a display kind for a WorkspaceItem (MIME/tags-first, mirrors Results.tsx)
const getItemKind = (it: WorkspaceItem): string => {
  const mt = String(it.content.mimeType || '').toLowerCase();
  const tags = Array.isArray(it.metadata.tags) ? it.metadata.tags.map(t => String(t).toLowerCase()) : [];
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

  
  const [wsItems, setWsItems] = useState<WorkspaceItem[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
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

  const renderMessageContent = (message: any) => {
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length) {
      return (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {toolCalls.map((tc: any) => {
            const args = typeof tc?.function?.arguments === 'string' ? tc.function.arguments : '';
            const preview = args.length > 160 ? `${args.slice(0, 160)}…` : args;
            return (
              <Box key={tc?.id || `${tc?.function?.name}-${preview}`}
                sx={{ fontFamily: 'monospace' }}>
                <Typography variant="caption" color="text.secondary">{t('conversations.detail.toolCall')}</Typography>
                <Typography variant="body2">{tc?.function?.name || 'unknown'}({preview})</Typography>
              </Box>
            );
          })}
        </Stack>
      );
    }

    if (message?.role === 'tool') {
      const payload = typeof message?.content === 'string' ? message.content : '';
      if (payload) {
        try {
          const parsed = JSON.parse(payload);
          return (
            <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(parsed, null, 2)}</pre>
          );
        } catch {
          return <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{payload}</Typography>;
        }
      }
      return <Typography variant="body2" color="text.secondary">{t('conversations.detail.noToolContent')}</Typography>;
    }

    if (typeof message?.content === 'string' && message.content.trim()) {
      return <ReactMarkdown>{message.content}</ReactMarkdown>;
    }

    if (Array.isArray(message?.content)) {
      return (
        <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(message.content, null, 2)}</pre>
      );
    }

    return <Typography variant="body2" color="text.secondary">{t('conversations.detail.noContent')}</Typography>;
  };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch<{ items: ConversationThread[] }>(`/api/conversations`);
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
    apiFetch<Agent[]>('/api/agents').then(setAgents).catch(() => {});
    apiFetch<Director[]>('/api/directors').then(setDirectors).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayItems = items;


  async function deleteOne(id: string) {
    const ok = window.confirm(t('conversations.confirm.deleteOne', { id }));
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
      await apiFetch('/api/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
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
      const json = await apiFetch<ConversationThread>(`/api/conversations/${encodeURIComponent(id)}`);
      setDetail({ thread: json });
      const thread = json;
      await loadWorkspaceItems(thread.id);
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
      const json = await apiFetch<WorkspaceItem[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/items`);
      setWsItems(json || []);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    } finally {
      setWsLoading(false);
    }
  }
  

  function openEdit(item: WorkspaceItem) {
    setEditTarget(item);
    setEditLabel((item as any)?.metadata?.label || '');
    setEditDescription((item as any)?.metadata?.description || '');
    setEditData((item as any)?.content?.data || '');
    setEditMimeType(((item as any)?.content?.mimeType) || '');
    setEditEncoding((((item as any)?.content?.encoding) as any) || '');
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!detail || detail.thread.kind !== 'director' || !editTarget) return;
    try {
      await apiFetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(editTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: ((editTarget as any)?.lifecycle?.revision ?? 1) as number,
          metadata: {
            ...(editLabel ? { label: editLabel } : {}),
            ...(editDescription ? { description: editDescription } : {}),
          },
          content: {
            ...(editMimeType ? { mimeType: editMimeType } : {}),
            ...(editEncoding ? { encoding: editEncoding } : {}),
            ...(typeof editData === 'string' ? { data: editData } : {}),
          }
        })
      });
      setEditOpen(false);
      setEditTarget(null);
      await loadWorkspaceItems(detail.thread.id);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    }
  }

  

  async function deleteWorkspaceItem(item: WorkspaceItem, hard = false) {
    if (!detail || detail.thread.kind !== 'director') return;
    try {
      await apiFetch(`/api/workspaces/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(item.id)}?hard=${hard}`, {
        method: 'DELETE'
      });
      await loadWorkspaceItems(detail.thread.id);
    } catch (e: any) {
      setWsError(e?.message || String(e));
    }
  }

  

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
                color={detail.thread.status === 'failed' ? 'error' : detail.thread.status === 'ongoing' ? 'warning' : 'success'}
              />
            </Stack>
          </Stack>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`conversations.filters.kindOptions.${detail.thread.kind}` as any)} • {t('conversations.table.director')}={directors.find(d => d.id === detail.thread.directorId)?.name || detail.thread.directorId} ({detail.thread.directorId}) • {t('conversations.table.agent')}={detail.thread.agentId ? `${(agents.find(a => a.id === detail.thread.agentId)?.name || detail.thread.agentId)} (${detail.thread.agentId})` : '-'} • {t('conversations.table.started')}={detail.thread.startedAt}
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
                  {renderMessageContent(m)}
                </Box>
              </Box>
            ))}
            {!detail.thread.messages.length && <Typography variant="body2" color="text.secondary">{t('conversations.detail.noMessages')}</Typography>}
          </Box>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" gutterBottom>{t('conversations.workspace.title')}</Typography>
          {wsError && <Alert severity="error" sx={{ mb: 1 }}>{wsError}</Alert>}
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
                {wsItems.map((a: WorkspaceItem) => (
                  <TableRow key={a.id}>
                    <TableCell><Chip size="small" label={getItemKind(a)} /></TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {(() => {
                          const prov = (a as any)?.provenance as any;
                          if (!prov) return '';
                          const by = prov.createdBy || '';
                          const who = prov.creatorId ? `:${prov.creatorId}` : '';
                          const tool = prov.toolName ? `/${prov.toolName}` : '';
                          return `${by}${who}${tool}`;
                        })()}
                      </Typography>
                    </TableCell>
                    <TableCell>{(((a as any)?.metadata?.tags) || []).map((tTag: any, i: number) => <Chip key={i} size="small" label={String(tTag)} sx={{ mr: 0.5 }} />)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(() => {
                          const label = (a as any)?.metadata?.label as any;
                          const desc = (a as any)?.metadata?.description as any;
                          if (typeof label === 'string' && label.trim()) return label;
                          if (typeof desc === 'string' && desc.trim()) return desc;
                          const d = (a as any)?.content?.data as any;
                          const enc = (a as any)?.content?.encoding as any;
                          if (typeof d === 'string') {
                            try { return enc === 'base64' ? atob(d) : d; } catch { return d; }
                          }
                          return '';
                        })()}
                      </Typography>
                    </TableCell>
                    <TableCell><Typography variant="caption">{((a as any)?.content?.mimeType) || '-'}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{((a as any)?.lifecycle?.revision ?? '-') as any}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{((a as any)?.lifecycle?.created) as any}</Typography></TableCell>
                    <TableCell><Typography variant="caption">{((a as any)?.lifecycle?.updated) as any}</Typography></TableCell>
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
                {!wsItems.length && (
                  <TableRow>
                    <TableCell colSpan={detail.thread.kind === 'director' ? 12 : 11}><Typography variant="body2" color="text.secondary">{t('conversations.workspace.empty')}</Typography></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          
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
        </>
      )}
    </Paper>
  );
}
