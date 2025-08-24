import React, { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Stack, Typography, Button, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Chip, Tabs, Tab, Pagination } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getDiagnosticsTraces, getDiagnosticsTrace, TracesListResponse, TraceSummaryItem, deleteDiagnosticsTrace, deleteDiagnosticsTracesBulk } from './utils/api';

// Types aligned with backend diagnostics contract (imported from utils/api)

interface TraceDetailSpan {
  id: string;
  type: string;
  name?: string;
  status?: string;
  start?: string;
  end?: string;
  durationMs?: number;
  payload?: any;
}

interface TraceDetail {
  id: string;
  createdAt?: string;
  emailId?: string;
  directorId?: string;
  agentId?: string;
  status?: string;
  spans?: TraceDetailSpan[];
}

export default function TracesDiagnostics() {
  const { t } = useTranslation();
  // Paging
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // Data
  const [list, setList] = useState<TraceSummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailTab, setDetailTab] = useState(0);
  const [bootstrapped, setBootstrapped] = useState(false);
  const visibleCount = useMemo(() => list.length, [list]);

  // Derived timeline metrics
  const timeline = useMemo(() => {
    if (!detail?.spans?.length) return null;
    const spans = detail.spans
      .map(s => {
        const startMs = s.start ? Date.parse(s.start) : NaN;
        const endMs = s.end ? Date.parse(s.end) : (!isNaN(startMs) && s.durationMs ? startMs + s.durationMs : NaN);
        const dur = (!isNaN(startMs) && !isNaN(endMs)) ? Math.max(0, endMs - startMs) : (s.durationMs ?? 0);
        return { ...s, startMs, endMs, dur } as TraceDetailSpan & { startMs: number; endMs: number; dur: number };
      })
      .filter(s => !isNaN(s.startMs) && (!isNaN(s.endMs) || s.dur >= 0))
      .sort((a, b) => a.startMs - b.startMs);
    if (!spans.length) return null;
    const minStart = spans.reduce((m, s) => Math.min(m, s.startMs), spans[0].startMs);
    const maxEnd = spans.reduce((m, s) => Math.max(m, isNaN(s.endMs) ? (s.startMs + s.dur) : s.endMs), spans[0].endMs || spans[0].startMs + spans[0].dur);
    const total = Math.max(1, maxEnd - minStart);
    return { spans, minStart, maxEnd, total };
  }, [detail]);

  const colorFor = (type?: string, status?: string) => {
    if (status === 'error') return '#f44336';
    if (type === 'provider_call') return '#1976d2';
    if (type === 'tool_call') return '#7b1fa2';
    if (type === 'openai_call') return '#00897b';
    if (type === 'conversation_update') return '#5d4037';
    return '#616161';
  };

  const fetchList = async () => {
    setLoading(true);
    const data: TracesListResponse = await getDiagnosticsTraces({
      limit: pageSize, offset: (page - 1) * pageSize,
    });
    setList(data.items || []);
    setTotal(data.total || 0);
    setLoading(false);
    if (!activeId && data.items?.[0]?.id) setActiveId(data.items[0].id);
  };

  const fetchDetail = async (id: string) => {
    const data: TraceDetail = await getDiagnosticsTrace(id);
    setDetail(data);
  };

  const onDeleteActive = async () => {
    if (!activeId) return;
    if (!window.confirm(t('traces.confirm.deleteOne', { id: activeId }))) return;
    try {
      await deleteDiagnosticsTrace(activeId);
      // Refresh list
      await fetchList();
      // Clear detail if deleted
      if (detail?.id === activeId) {
        setDetail(null);
        setActiveId(list[0]?.id ?? null);
      }
    } catch (e) {
      alert(t('traces.errors.failedDelete'));
    }
  };

  const onDeleteAll = async () => {
    const ids = list.map(x => x.id);
    if (!ids.length) return;
    if (!window.confirm(t('traces.confirm.deleteAll', { count: ids.length }))) return;
    try {
      await deleteDiagnosticsTracesBulk(ids);
      setActiveId(null);
      setDetail(null);
      await fetchList();
    } catch (e) {
      alert(t('traces.errors.failedBulkDelete'));
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Deep-link bootstrap removed (no filters)
  useEffect(() => { setBootstrapped(true); }, [bootstrapped]);

  useEffect(() => {
    if (activeId) fetchDetail(activeId);
  }, [activeId]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>{t('traces.title')}</Typography>

      {/* Filter bar removed: canonical diagnostics list has no filtering/sorting */}

      <Box sx={{ display: 'flex', gap: 2, height: '70vh' }}>
        <Paper variant="outlined" sx={{ p: 1, overflow: 'auto', resize: 'horizontal', minWidth: 320, maxWidth: '70%', flexBasis: '45%', flexGrow: 0, flexShrink: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="flex-end" sx={{ mb: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" color="error" variant="outlined" disabled={!activeId || loading} onClick={onDeleteActive}>{t('traces.tooltips.deleteActive')}</Button>
              <Button size="small" color="error" variant="contained" disabled={!visibleCount || loading} onClick={onDeleteAll}>{t('traces.tooltips.deleteAll')}</Button>
              <Pagination size="small" page={page} onChange={(_, p) => setPage(p)} count={pageCount} />
            </Stack>
          </Stack>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('traces.table.time')}</TableCell>
                  <TableCell>{t('traces.table.status')}</TableCell>
                  <TableCell>{t('traces.table.spans')}</TableCell>
                  <TableCell>{t('traces.table.email')}</TableCell>
                  <TableCell>{t('traces.table.director')}</TableCell>
                  <TableCell>{t('traces.table.agent')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map(item => (
                  <TableRow key={item.id} hover selected={activeId === item.id} onClick={() => setActiveId(item.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell>{item.createdAt || ''}</TableCell>
                    <TableCell>{item.status ? <Chip size="small" color={item.status === 'error' ? 'error' : item.status === 'ok' ? 'success' : 'default'} label={item.status} /> : null}</TableCell>
                    <TableCell>{item.spanCount ?? ''}</TableCell>
                    <TableCell>{item.emailId || ''}</TableCell>
                    <TableCell>{item.directorId || ''}</TableCell>
                    <TableCell>{item.agentId || ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={t('traces.detail.overview')} />
            <Tab label={t('traces.detail.spansJson')} />
          </Tabs>
          <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
            {!detail ? (
              <Typography variant="body2" color="text.secondary">{t('traces.detail.select')}</Typography>
            ) : (
              detailTab === 0 ? (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>Trace</Typography>
                  <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                    {JSON.stringify({ id: detail.id, createdAt: detail.createdAt, status: detail.status, emailId: detail.emailId, directorId: detail.directorId, agentId: detail.agentId, spanCount: detail.spans?.length || 0 }, null, 2)}
                  </Box>
                  {timeline && (
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ position: 'relative', height: 160, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, bgcolor: 'background.paper' }}>
                        {/* lanes stacked vertically */}
                        <Box sx={{ position: 'absolute', inset: 8, overflow: 'hidden' }}>
                          {timeline.spans.map((s, idx) => {
                            const leftPct = ((s.startMs - timeline.minStart) / timeline.total) * 100;
                            const widthPct = ((s.dur || 1) / timeline.total) * 100;
                            return (
                              <Box key={s.id || idx}
                                title={`${s.type || ''} ${s.name || ''} (${s.dur}ms)`}
                                sx={{
                                  position: 'absolute',
                                  top: `${idx * 26}px`,
                                  left: `${Math.max(0, Math.min(100, leftPct))}%`,
                                  width: `${Math.max(0.5, Math.min(100, widthPct))}%`,
                                  height: 20,
                                  bgcolor: colorFor(s.type, s.status),
                                  borderRadius: 0.5,
                                }}
                              />
                            );
                          })}
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('traces.detail.timelineCaption')}
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>{t('traces.detail.spans')}</Typography>
                  <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                    {JSON.stringify(detail.spans || [], null, 2)}
                  </Box>
                </Box>
              )
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
