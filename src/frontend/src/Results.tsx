import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert,
  Chip,
  Button,
  Stack,
  IconButton,
  Tooltip,
  TextField,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  ListSubheader,
  Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MailOutline from '@mui/icons-material/MailOutline';
import AccountTree from '@mui/icons-material/AccountTree';
import Description from '@mui/icons-material/Description';
import Image from '@mui/icons-material/Image';
import Code from '@mui/icons-material/Code';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationThread, WorkspaceItem } from '../../shared/types';
import { useTranslation } from 'react-i18next';

// Use canonical OrchestrationResultEntry type from shared/types

export default function Results() {
  const { t, i18n } = useTranslation();
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Selection is at group-level (grouped by email id); stores group keys
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [directors, setDirectors] = useState<any[]>([]);
  // Right pane shows a single view at a time
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [activeDirectorId, setActiveDirectorId] = useState<string | 'all'>('all');
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  // Expansion state for left navigation
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  // WorkspaceItem render kind derived strictly from mimeType
  type RenderKind = 'markdown' | 'text' | 'html' | 'json' | 'image' | 'attachment' | 'binary' | 'draft_reply' | 'error';
  const getItemKind = (it: WorkspaceItem): RenderKind => {
    const mt = String(it.mimeType || '').toLowerCase();
    if (mt === 'application/vnd.ia.draft-reply+json' || mt === 'application/x-ia-draft-reply+json') return 'draft_reply';
    if (mt === 'application/vnd.ia.error+json') return 'error';
    if (mt.startsWith('image/')) return 'image';
    if (mt.includes('markdown')) return 'markdown';
    if (mt.includes('html')) return 'html';
    if (mt.startsWith('text/')) return 'text';
    if (mt.includes('json')) return 'json';
    return 'binary';
  };

  // Localized date/time formatter
  const dateFormatter = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }, [i18n.language]);
  const formatDateStr = (s?: string) => {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return dateFormatter.format(d);
  };
  const getItemTitle = (it: WorkspaceItem): string => {
    const kind = getItemKind(it);
    const baseName = (it.label || '').trim();
    const base = baseName || (kind === 'binary' ? (it.mimeType || 'item') : kind);
    const suffix = Array.isArray(it.tags) && it.tags.length ? ` • ${it.tags.join(', ')}` : '';
    return `${base}${suffix}`;
  };

  // Robust time parsing for stable sorting
  const parseTime = (s?: string) => {
    if (!s) return 0;
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  };

  // No chat handlers in simplified browser

  // Fetch directors for fixed ordering and display names
  useEffect(() => {
    fetch('/api/directors')
      .then(r => r.json())
      .then(setDirectors)
      .catch(() => void 0);
  }, []);
  const directorOrder = useMemo(() => directors.map((d: any) => d.id), [directors]);
  const directorNameMap = useMemo(() => Object.fromEntries(directors.map((d: any) => [d.id, d.name])), [directors]);
  // No agent grouping or names in simplified browser

  const fetchThreads = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/conversations?kind=director&limit=1000').then(r => r.json()),
      fetch('/api/workspaces/default/items').then(r => r.json())
    ])
      .then(([conversationData, workspaceData]) => {
        setThreads(Array.isArray(conversationData?.items) ? conversationData.items : []);
        setWorkspaceItems(Array.isArray(workspaceData) ? workspaceData : []);
        setLoading(false);
      })
      .catch(() => { setError(t('results.failedLoad')); setLoading(false); });
  };

  useEffect(() => { fetchThreads(); }, []);

  // Group entries by email id (or timestamp if missing) for a cleaner root view
  const groups = useMemo(() => {
    const m = new Map<string, ConversationThread[]>();
    for (const t of threads) {
      const key = (t.email as any)?.id || t.id;
      const list = m.get(key) || [];
      list.push(t);
      m.set(key, list);
    }
    const arr = Array.from(m.entries()).map(([key, list]) => {
      const anyWithEmail = list.find(x => !!x.email);
      const email = (anyWithEmail?.email || list[0]?.email) as any;
      const subject = email?.subject || t('results.noSubject');
      const from = email?.from || '';
      const date = email?.date || '';
      // Sort threads in a group by startedAt desc
      const sorted = list.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      return { key, email, subject, from, date, threads: sorted };
    });
    // Sort groups by email date desc if present; fallback to latest thread startedAt
    arr.sort((a, b) => {
      const da = a.email?.date || a.threads[0]?.startedAt || '';
      const db = b.email?.date || b.threads[0]?.startedAt || '';
      const ta = parseTime(da);
      const tb = parseTime(db);
      if (ta === tb) return 0;
      return ta > tb ? -1 : 1;
    });
    return arr;
  }, [threads, t]);

  // Filter groups by subject/from (case-insensitive)
  const filteredGroups = useMemo(() => {
    const q = groupFilter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      (g.subject || '').toLowerCase().includes(q) || (g.from || '').toLowerCase().includes(q)
    );
  }, [groups, groupFilter]);

  // Keep active group selection stable across refreshes
  useEffect(() => {
    if (!groups.length) { setActiveGroupKey(null); return; }
    const exists = groups.find(g => g.key === activeGroupKey);
    if (!exists) {
      setActiveGroupKey(groups[0].key);
      setActiveDirectorId('all');
      setActiveItemId(null);
    }
  }, [groups, activeGroupKey]);

  // Reset director selection when switching active email group
  // Removed auto-reset of director selection on activeGroupKey change to avoid
  // overriding a director click in a non-active group. Group list click already
  // resets director to 'all' explicitly.

  const activeGroup = useMemo(() => groups.find(g => g.key === activeGroupKey) || groups[0] || null, [groups, activeGroupKey]);

  // Active single workspace item (when a director child node is clicked)
  const activeItem = useMemo(() => {
    if (!activeItemId) return null;
    return workspaceItems.find((i: WorkspaceItem) => i.id === activeItemId) || null;
  }, [activeItemId, workspaceItems]);

  // No chat/thread loading in simplified browser

  // No deprecated orchestration delete/send actions in canonical view

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">{t('results.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title={t('results.refresh')}>
            <span>
              <IconButton size="small" onClick={fetchThreads} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <Typography color="text.secondary" component="span">{t('results.processing')}</Typography>}
      <Box sx={{ display: 'flex', gap: 2, mt: 2, height: '70vh' }}>
        <Paper variant="outlined" sx={{ width: 400, overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ pl: 1.25, pr: 0, py: 0, overflow: 'auto', flex: 1 }}>
          <List
            dense
            subheader={
              <ListSubheader component="div" sx={{ bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid', borderColor: 'divider', backdropFilter: 'saturate(180%) blur(6px)' }}>
                <Box sx={{ p: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('results.emails')}</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder={t('results.filterPlaceholder')}
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  />
                </Box>
              </ListSubheader>
            }
          >
            {groups.length === 0 ? (
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" color="text.secondary">{t('results.noResults')}</Typography>
              </Box>
            ) : filteredGroups.length === 0 ? (
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" color="text.secondary">{t('results.noMatches')}</Typography>
              </Box>
            ) : filteredGroups.map((g) => (
              <React.Fragment key={g.key}>
                {(() => {
                  const isExpanded = expandedGroups[g.key] ?? (activeGroupKey === g.key);
                  const toggleGroup = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedGroups((s) => ({ ...s, [g.key]: !isExpanded })); };
                  const selectGroup = () => { setActiveGroupKey(g.key); setActiveDirectorId('all'); setActiveItemId(null); };
                  return (
                    <>
                      <ListItemButton selected={activeGroupKey === g.key} onClick={selectGroup} sx={{ alignItems: 'center', pl: 1.25, pr: 1, py: 0.75, borderRadius: 1, position: 'relative', '&:hover': { backgroundColor: 'action.hover' }, '&.Mui-selected': { backgroundColor: 'action.selected' }, '&.Mui-selected::before': { content: '""', position: 'absolute', left: 0, top: 5, bottom: 5, width: 2, bgcolor: 'primary.main', borderRadius: 2 }, '& .MuiListItemIcon-root': { color: 'text.secondary' }, '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' } }}>
                        <ListItemIcon sx={{ minWidth: 28, mr: 1 }}>
                          <MailOutline fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true, sx: { lineHeight: 1.4 } }}
                          secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary', noWrap: true, sx: { lineHeight: 1.3 } }}
                          primary={g.subject}
                          secondary={`${g.from || ''}${g.date ? ` • ${formatDateStr(g.date)}` : ''}`}
                        />
                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
                          <IconButton size="small" edge="end" aria-label={isExpanded ? t('results.collapse') : t('results.expand')} onClick={toggleGroup} sx={{ ml: 0 }}>
                            {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                          </IconButton>
                        </Box>
                      </ListItemButton>
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <List dense disablePadding sx={{ pl: 0 }}>
                          {Array.from(new Set((g.threads || []).map((t: any) => t.directorId).filter((x: any) => !!x)))
                            .sort((a: string, b: string) => {
                              const ia = directorOrder.indexOf(a);
                              const ib = directorOrder.indexOf(b);
                              if (ia === -1 && ib === -1) return a.localeCompare(b);
                              if (ia === -1) return 1;
                              if (ib === -1) return -1;
                              return ia - ib;
                            })
                            .map((dirId: string) => {
                              const isDirectorSelected = activeGroupKey === g.key && activeDirectorId === dirId && !activeItemId;
                              const name = directorNameMap[dirId] || dirId;
                              const dirThreads = (g.threads || []).filter((t: any) => t.directorId === dirId);
                              const items: WorkspaceItem[] = workspaceItems
                                .filter((i: WorkspaceItem) => i.provenance?.by === 'agent' && dirThreads.some(t => t.id === i.provenance?.conversationId))
                                .filter((i: any) => !i.deleted) as any;
                              const dirKey = `${g.key}:${dirId}`;
                              const dirExpanded = expandedDirs[dirKey] ?? true;
                              const toggleDir = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedDirs((s) => ({ ...s, [dirKey]: !dirExpanded })); };
                              const sortedItems = (items || []).slice().sort((a: any, b: any) => {
                                const ta = (a.created || a.updated || '') as string;
                                const tb = (b.created || b.updated || '') as string;
                                return (tb || '').localeCompare(ta || '');
                              });
                              return (
                                <React.Fragment key={dirId}>
                                  <ListItemButton
                                    selected={isDirectorSelected}
                                    onClick={(e) => { e.stopPropagation(); if (activeGroupKey !== g.key) setActiveGroupKey(g.key); setActiveDirectorId(dirId); setActiveItemId(null); }}
                                    sx={{ pl: 1.25, pr: 1, py: 0.625, borderRadius: 1, position: 'relative', '&:hover': { backgroundColor: 'action.hover' }, '&.Mui-selected': { backgroundColor: 'action.selected' }, '&.Mui-selected::before': { content: '""', position: 'absolute', left: 0, top: 5, bottom: 5, width: 2, bgcolor: 'primary.main', borderRadius: 2 }, '& .MuiListItemIcon-root': { color: 'text.secondary' }, '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' } }}
                                  >
                                    <ListItemIcon sx={{ minWidth: 26, mr: 0.75 }}>
                                      <AccountTree fontSize="small" />
                                    </ListItemIcon>
                                    <ListItemText primaryTypographyProps={{ variant: 'body2', sx: { lineHeight: 1.4 } }} primary={name} />
                                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
                                      <Chip label={sortedItems.length} size="small" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, lineHeight: '20px' } }} />
                                      <IconButton size="small" edge="end" aria-label={dirExpanded ? t('results.collapse') : t('results.expand')} onClick={toggleDir} sx={{ ml: 0 }}>
                                        {dirExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                      </IconButton>
                                    </Box>
                                  </ListItemButton>
                                  <Collapse in={dirExpanded} timeout="auto" unmountOnExit>
                                    <List dense disablePadding sx={{ pl: 0 }}>
                                      {sortedItems.length === 0 ? (
                                        <ListItemButton disableRipple disableTouchRipple sx={{ cursor: 'default', pl: 1.25, pr: 1, py: 0.5, opacity: 0.7 }}>
                                          <ListItemText primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} primary={t('results.noItems')} />
                                        </ListItemButton>
                                      ) : (
                                        sortedItems.map((it: any) => {
                                          const isChildActive = activeItemId === it.id;
                                          return (
                                            <ListItemButton
                                              key={`${dirId}-item-${it.id}`}
                                              selected={isChildActive}
                                              onClick={(ev) => { ev.stopPropagation(); if (activeGroupKey !== g.key) setActiveGroupKey(g.key); setActiveDirectorId(dirId); setActiveItemId(it.id); }}
                                              sx={{ pl: 1.25, pr: 1, py: 0.5, borderRadius: 1, position: 'relative', '&:hover': { backgroundColor: 'action.hover' }, '&.Mui-selected': { backgroundColor: 'action.selected' }, '&.Mui-selected::before': { content: '""', position: 'absolute', left: 0, top: 5, bottom: 5, width: 2, bgcolor: 'primary.main', borderRadius: 2 } }}
                                            >
                                              <ListItemIcon sx={{ minWidth: 24, mr: 0.75 }}>
                                                {(() => {
                                                  const k = getItemKind(it as WorkspaceItem);
                                                  if (k === 'image') return <Image fontSize="small" />;
                                                  if (k === 'json') return <Code fontSize="small" />;
                                                  if (k === 'error') return <WarningAmber fontSize="small" color="warning" />;
                                                  return <Description fontSize="small" />;
                                                })()}
                                              </ListItemIcon>
                                              <ListItemText
                                                primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { lineHeight: 1.4 } }}
                                                primary={getItemTitle(it as WorkspaceItem)}
                                              />
                                            </ListItemButton>
                                          );
                                        })
                                      )}
                                    </List>
                                  </Collapse>
                                </React.Fragment>
                              );
                            })}
                        </List>
                      </Collapse>
                    </>
                  );
                })()}
              </React.Fragment>
            ))}
          </List>
          </Box>
        </Paper>

        {/* Right: Single view (item preview only) */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <Paper variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 2, flex: 1, overflow: 'auto' }}>
            {activeItem ? (
              (() => {
                const dirId = String(activeDirectorId);
                const name = directorNameMap[dirId] || dirId;
                const item = activeItem as WorkspaceItem;

                const renderItem = (it: WorkspaceItem) => {
                  const kind = getItemKind(it);
                  const decodeText = (): string => {
                    const d = it.data;
                    if (typeof d !== 'string') return '';
                    try { return it.encoding === 'base64' ? atob(d) : d; } catch { return d; }
                  };
                  if (kind === 'markdown' || kind === 'text') {
                    const text = decodeText();
                    return (
                      <Box sx={{
                        mt: 1,
                        color: 'text.primary',
                        '& p': { mb: 1.25, lineHeight: 1.7 },
                        '& h1': { fontSize: '1.4rem', fontWeight: 700, mt: 2, mb: 1 },
                        '& h2': { fontSize: '1.15rem', fontWeight: 700, mt: 1.75, mb: 0.75 },
                        '& h3': { fontSize: '1rem', fontWeight: 600, mt: 1.5, mb: 0.5 },
                        '& ul, & ol': { pl: 3, mb: 1.25 },
                        '& a': { color: 'primary.main', textDecoration: 'none' },
                        '& a:hover': { textDecoration: 'underline' },
                        '& code': { px: 0.5, py: 0.25, borderRadius: 0.5, bgcolor: 'action.hover', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
                        '& pre': { p: 1.25, borderRadius: 1, bgcolor: 'action.hover', overflow: 'auto' },
                        '& blockquote': { m: 0, pl: 2, borderLeft: '3px solid', borderColor: 'divider', color: 'text.secondary' },
                        '& table': { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', mb: 1.5 },
                        '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1, py: 0.5 },
                        '& hr': { border: 0, borderTop: '1px solid', borderColor: 'divider', my: 1.25 },
                      }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                          {text}
                        </ReactMarkdown>
                      </Box>
                    );
                  }
                  if (kind === 'html') {
                    const html = decodeText();
                    return <Box sx={{ mt: 1 }} dangerouslySetInnerHTML={{ __html: html }} />;
                  }
                  if (kind === 'json' || kind === 'error') {
                    const d = it.data;
                    let out = '';
                    if (typeof d === 'string') {
                      try {
                        const s = it.encoding === 'base64' ? atob(d) : d;
                        try { out = JSON.stringify(JSON.parse(s), null, 2); } catch { out = s; }
                      } catch { out = d; }
                    }
                    return (
                      <Box sx={{ mt: 1 }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{out}</pre>
                      </Box>
                    );
                  }
                  if (kind === 'image' || kind === 'attachment' || kind === 'binary') {
                    const mt = (it.mimeType || 'application/octet-stream');
                    const enc = (it.encoding || 'utf8');
                    const dataUrl =
                      typeof it.data === 'string' && it.data.length
                        ? (enc === 'base64'
                            ? `data:${mt};base64,${it.data}`
                            : `data:${mt},${encodeURIComponent(it.data)}`)
                        : undefined;
                    return (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography variant="subtitle2">{it.label || (kind === 'image' ? (t('results.image') as string) : (t('results.attachment') as string))}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                          {dataUrl && (it.mimeType || '')?.toLowerCase?.().startsWith('image/') && (
                            <img src={dataUrl} alt={t('results.imageAlt')} style={{ maxHeight: 120, borderRadius: 4 }} />
                          )}
                          <a href={dataUrl || '#'} target="_blank" rel="noopener noreferrer">{t('results.open')}</a>
                          {it.mimeType && <Chip label={it.mimeType} size="small" />}
                        </Box>
                      </Box>
                    );
                  }
                  const s = decodeText();
                  return (
                    <Box sx={{ mt: 1 }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s || it.description || ''}</pre>
                    </Box>
                  );
                };

                return (
                  <Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="h6">{item.label || t('results.preview')} · {name}</Typography>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="text" onClick={() => setActiveItemId(null)}>{t('results.backToDirector')}</Button>
                      </Stack>
                    </Stack>
                    <Divider sx={{ mb: 1.5 }} />
                    {renderItem(item)}
                  </Box>
                );
              })()
            ) : (
              <Typography variant="body2" color="text.secondary">{t('results.selectItem')}</Typography>
            )}
            </Box>
          </Paper>
        </Box>
      </Box>

      {/* End grouped details */}
    </Box>
  );
}
