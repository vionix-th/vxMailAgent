import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Alert, Chip, IconButton, Tooltip, Stack, Button, Divider,
  Accordion, AccordionSummary, AccordionDetails, ToggleButton, ToggleButtonGroup, Tabs, Tab
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { OrchestrationDiagnosticEntry } from '../../shared/types';
import { getOrchestrationDiagnostics, deleteOrchestrationDiagnosticOne, deleteOrchestrationDiagnosticsBulk, getDiagnosticsRuntime } from './utils/api';
import { useTranslation } from 'react-i18next';
import { useCookieState } from './hooks/useCookieState';

type AgentBucket = {
  agentThreadId: string;
  agent?: string;
  agentName?: string;
  entries: OrchestrationDiagnosticEntry[];
};

type FlowItemEntry = { kind: 'entry'; ts: number; entry: OrchestrationDiagnosticEntry };
type FlowItemAgent = { kind: 'agent'; ts: number; agent: AgentBucket };
type FlowItem = FlowItemEntry | FlowItemAgent;

export default function OrchestrationDiagnostics() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OrchestrationDiagnosticEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTs, setActiveTs] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<any>(null);
  const [showEmailRaw, setShowEmailRaw] = useState(false);
  const [showResultJson, setShowResultJson] = useState(true);
  const [showDetailJson, setShowDetailJson] = useState(false);
  const [grouped, setGrouped] = useCookieState<boolean>('vx_ui.orchestration.grouped', true, { maxAge: 60 * 60 * 24 * 365 });
  const [detailTab, setDetailTab] = useCookieState<number>('vx_ui.orchestration.detailTab', 0, { maxAge: 60 * 60 * 24 * 365 });

  const fetchEntries = () => {
    setLoading(true);
    getOrchestrationDiagnostics()
      .then(resp => {
        const items = resp?.items || [];
        setEntries(items);
        setActiveTs(prev => {
          const still = items.find(e => e.timestamp === prev);
          return still ? still.timestamp : (items[0]?.timestamp || null);
        });
        setLoading(false);
      })
      .catch(() => { setError(t('orchestration.errors.failedLoad')); setLoading(false); });
  };

  const openTraceFor = (e: OrchestrationDiagnosticEntry) => {
    const intent = {
      emailId: (e.email as any)?.id || undefined,
      directorId: (e as any)?.dirThreadId || undefined,
      agentId: (e as any)?.agentThreadId || undefined,
    };
    try { localStorage.setItem('ia.intent.trace', JSON.stringify(intent)); } catch {}
    window.dispatchEvent(new Event('ia-open-trace'));
  };

  const deleteById = async (id?: string, timestamp?: string) => {
    if (!id) return;
    const ok = window.confirm(t('orchestration.confirm.deleteOne', { timestamp: timestamp || id }));
    if (!ok) return;
    try {
      await deleteOrchestrationDiagnosticOne(id);
      fetchEntries();
    } catch (_) {}
  };

  const deleteAll = async () => {
    if (!entries.length) return;
    const ok = window.confirm(t('orchestration.confirm.deleteAll', { count: entries.length }));
    if (!ok) return;
    try {
      const ids = entries.map(e => e.id!).filter(Boolean);
      if (!ids.length) return;
      await deleteOrchestrationDiagnosticsBulk(ids);
      fetchEntries();
    } catch (_) {}
  };

  useEffect(() => { fetchEntries(); }, []);
  useEffect(() => {
    getDiagnosticsRuntime().then(setRuntime).catch(() => {});
  }, []);

  const activeEntry = useMemo(() => entries.find(e => e.timestamp === activeTs) || entries[0] || null, [entries, activeTs]);
  const groupedTree = useMemo(() => {
    const cycles = new Map<string, any>();
    for (const e of entries) {
      const cycleId = e.fetchCycleId || 'unknown';
      if (!cycles.has(cycleId)) cycles.set(cycleId, { cycleId, directors: new Map<string, any>() });
      const c = cycles.get(cycleId);
      const dirKey = e.dirThreadId || 'unknown';
      if (!c.directors.has(dirKey)) c.directors.set(dirKey, {
        dirThreadId: e.dirThreadId || 'unknown',
        director: e.director,
        directorName: e.directorName,
        emailSummary: e.email?.subject || e.emailSummary,
        directorEntries: [] as OrchestrationDiagnosticEntry[],
        agents: new Map<string, any>(),
      });
      const d = c.directors.get(dirKey);
      if (e.agentThreadId) {
        const atKey = e.agentThreadId;
        if (!d.agents.has(atKey)) d.agents.set(atKey, { agentThreadId: atKey, agent: e.agent, agentName: e.agentName, entries: [] as OrchestrationDiagnosticEntry[] });
        d.agents.get(atKey).entries.push(e);
      } else {
        d.directorEntries.push(e);
      }
    }
    // Build array structure; strict grouping by canonical fields only.
    const toMs = (ts: string) => {
      const n = Date.parse(ts);
      return isNaN(n) ? 0 : n;
    };
    const arr = Array.from(cycles.values()).map((c: any) => {
      const directors = Array.from(c.directors.values()).map((d: any) => {
        // Sort director entries by timestamp
        (d.directorEntries || []).sort((a: OrchestrationDiagnosticEntry, b: OrchestrationDiagnosticEntry) => toMs(a.timestamp) - toMs(b.timestamp));
        // Finalize agents array and sort their inner entries
        const agentsArray: AgentBucket[] = Array.from(d.agents.values()) as AgentBucket[];
        for (const a of agentsArray) {
          a.entries.sort((x: OrchestrationDiagnosticEntry, y: OrchestrationDiagnosticEntry) => toMs(x.timestamp) - toMs(y.timestamp));
        }
        // Build anchor map from director entries: agent invocation with sessionId
        const anchorTsBySession = new Map<string, number>();
        for (const en of (d.directorEntries || [])) {
          const sessionId = (en as any)?.detail?.tool === 'agent' && typeof (en as any)?.detail?.sessionId === 'string'
            ? String((en as any).detail.sessionId)
            : null;
          if (!sessionId) continue;
          const ts = toMs(en.timestamp);
          const prev = anchorTsBySession.get(sessionId);
          if (prev === undefined || ts < prev) anchorTsBySession.set(sessionId, ts);
        }
        // Compose unified flow: director entries + agent anchors interleaved by timestamp
        const flow: FlowItem[] = [];
        for (const en of (d.directorEntries || [])) {
          flow.push({ kind: 'entry', ts: toMs(en.timestamp), entry: en });
        }
        for (const a of agentsArray) {
          const firstEventTs = a.entries.length ? toMs(a.entries[0].timestamp) : Number.MAX_SAFE_INTEGER;
          const anchorTs = anchorTsBySession.get(a.agentThreadId) ?? firstEventTs;
          flow.push({ kind: 'agent', ts: anchorTs, agent: a });
        }
        flow.sort((a: FlowItem, b: FlowItem) => {
          if (a.ts !== b.ts) return a.ts - b.ts;
          // Stable order at same timestamp: director entry before agent subtree
          const aOrder = a.kind === 'entry' ? 0 : 1;
          const bOrder = b.kind === 'entry' ? 0 : 1;
          return aOrder - bOrder;
        });
        return { ...d, agents: agentsArray, flow };
      });
      return { cycleId: c.cycleId, directors };
    });
    arr.sort((a: any, b: any) => (a.cycleId === 'unknown' ? 1 : b.cycleId === 'unknown' ? -1 : (a.cycleId > b.cycleId ? -1 : 1)));
    return arr;
  }, [entries]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">{t('orchestration.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <ToggleButtonGroup
            size="small"
            value={grouped ? 'grouped' : 'flat'}
            exclusive
            onChange={(_, val) => { if (val) setGrouped(val === 'grouped'); }}
          >
            <ToggleButton value="grouped">{t('orchestration.view.grouped')}</ToggleButton>
            <ToggleButton value="flat">{t('orchestration.view.flat')}</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title={t('orchestration.tooltips.refresh')}>
            <span>
              <IconButton size="small" onClick={fetchEntries} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('orchestration.tooltips.deleteActive')}>
            <span>
              <IconButton size="small" color="error" onClick={() => activeEntry?.id && deleteById(activeEntry.id, activeEntry.timestamp)} disabled={!activeEntry?.id}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('orchestration.tooltips.deleteAll')}>
            <span>
              <IconButton size="small" color="error" onClick={deleteAll} disabled={!entries.length}>
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <Typography color="text.secondary">{t('results.processing')}</Typography>}
      {runtime && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>{t('orchestration.runtime.title')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('orchestration.runtime.encryption')}</Typography>
              <Box>
                <Chip size="small" color={runtime.encryption?.enabled ? 'success' : 'default'} label={`${runtime.encryption?.mode || t('orchestration.runtime.disabled')} — ${runtime.encryption?.reason || ''}`} />
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('orchestration.runtime.orchestrationLogEntries')}</Typography>
              <div>{runtime.orchestrationLogCount ?? 0}</div>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('orchestration.runtime.conversations')}</Typography>
              <div>{runtime.conversationsCount ?? 0}</div>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('orchestration.runtime.dataDir')}</Typography>
              <div style={{ fontFamily: 'monospace' }}>{runtime.dataDir || ''}</div>
            </Box>
          </Box>
        </Paper>
      )}
      {/* Two-pane layout with resizable left pane and right-side details in tabs */}
      <Box sx={{ display: 'flex', gap: 2, height: '70vh' }}>
        {/* Left pane: grouped/flat tree */}
        <Paper variant="outlined" sx={{ p: 1, overflow: 'auto', resize: 'horizontal', minWidth: 300, maxWidth: '70%', flexBasis: '40%', flexGrow: 0, flexShrink: 0 }}>
          {grouped ? (
            <Box sx={{ mt: 1 }}>
              {groupedTree.map((cycle: any) => (
                <Accordion key={cycle.cycleId} defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}> 
                    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                      <Typography variant="subtitle1">{t('orchestration.grouped.cyclePrefix')} {cycle.cycleId === 'unknown' ? t('orchestration.grouped.unknown') : cycle.cycleId}</Typography>
                      <Chip size="small" label={t('orchestration.grouped.directorsCount', { count: cycle.directors.length })} />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    {cycle.directors.map((d: any, di: number) => (
                      <Accordion key={`${cycle.cycleId}-${d.dirThreadId || d.director}-${di}`} sx={{ mb: 1 }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}> 
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography variant="body1">{d.directorName || d.director}</Typography>
                            <Chip size="small" label={d.emailSummary} />
                            <Chip size="small" label={t('orchestration.grouped.eventsCount', { count: (d.directorEntries || []).length })} />
                            <Chip size="small" color="primary" label={t('orchestration.grouped.agentsCount', { count: (d.agents || []).length })} />
                          </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                          {(d.flow || []).map((item: FlowItem) => (
                            item.kind === 'entry' ? (
                              <Paper key={`de-${item.entry.timestamp}`} variant="outlined" sx={{ p: 1, mb: 1, cursor: 'pointer', borderColor: activeTs === item.entry.timestamp ? 'primary.main' : 'divider' }} onClick={() => setActiveTs(item.entry.timestamp)}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                  <Chip
                                    size="small"
                                    label={
                                      item.entry.phase === 'tool'
                                        ? (((item.entry as any)?.detail?.tool) || ((item.entry as any)?.result?.toolCallResult?.kind)
                                            ? `tool:${(((item.entry as any)?.detail?.tool) || ((item.entry as any)?.result?.toolCallResult?.kind))}`
                                            : 'tool')
                                        : (item.entry.phase === 'agent' && (item.entry as any)?.detail?.action
                                            ? `agent:${(item.entry as any)?.detail?.action}`
                                            : (item.entry.phase || 'event'))
                                    }
                                  />
                                  {item.entry.error ? <Chip size="small" color="error" label={t('orchestration.labels.error')} /> : null}
                                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{item.entry.timestamp}</Typography>
                                  <Box sx={{ flex: 1 }} />
                                  <Tooltip title={t('actions.delete')}>
                                    <IconButton size="small" color="error" onClick={(evt) => { evt.stopPropagation(); deleteById(item.entry.id, item.entry.timestamp); }}>
                                      <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title={t('actions.viewTrace') || 'View Trace'}>
                                    <IconButton size="small" onClick={(evt) => { evt.stopPropagation(); openTraceFor(item.entry); }}>
                                      <VisibilityOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              </Paper>
                            ) : (
                              <Accordion key={item.agent.agentThreadId} sx={{ mb: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}> 
                                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                    <Typography variant="body2">{t('orchestration.grouped.agentPrefix')} {item.agent.agentName || item.agent.agent}</Typography>
                                    <Chip size="small" label={t('orchestration.grouped.eventsCount', { count: item.agent.entries.length })} />
                                    {item.agent.entries.some((x: OrchestrationDiagnosticEntry) => !!x.error) ? <Chip size="small" color="error" label={t('orchestration.labels.errors')} /> : null}
                                  </Stack>
                                </AccordionSummary>
                                <AccordionDetails>
                                  {item.agent.entries.map((e: OrchestrationDiagnosticEntry, ei: number) => (
                                    <Paper key={`${e.timestamp}-${ei}`} variant="outlined" sx={{ p: 1, mb: 1, cursor: 'pointer', borderColor: activeTs === e.timestamp ? 'primary.main' : 'divider' }} onClick={() => setActiveTs(e.timestamp)}>
                                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                        <Chip
                                          size="small"
                                          label={
                                            e.phase === 'tool'
                                              ? (((e as any)?.detail?.tool) || ((e as any)?.result?.toolCallResult?.kind)
                                                  ? `tool:${(((e as any)?.detail?.tool) || ((e as any)?.result?.toolCallResult?.kind))}`
                                                  : 'tool')
                                              : (e.phase === 'agent' && (e as any)?.detail?.action
                                                  ? `agent:${(e as any)?.detail?.action}`
                                                  : (e.phase || 'event'))
                                          }
                                          color={e.phase === 'tool' ? 'secondary' : e.phase === 'agent' ? 'primary' : e.phase === 'result' ? 'success' as any : 'default'}
                                        />
                                        {e.error ? <Chip size="small" color="error" label={t('orchestration.labels.error')} /> : null}
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{e.timestamp}</Typography>
                                        <Box sx={{ flex: 1 }} />
                                        <Tooltip title={t('actions.delete')}>
                                          <IconButton size="small" color="error" onClick={(evt) => { evt.stopPropagation(); deleteById(e.id, e.timestamp); }}>
                                            <DeleteOutlineIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t('actions.viewTrace') || 'View Trace'}>
                                          <IconButton size="small" onClick={(evt) => { evt.stopPropagation(); openTraceFor(e); }}>
                                            <VisibilityOutlinedIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </Stack>
                                    </Paper>
                                  ))}
                                </AccordionDetails>
                              </Accordion>
                            )
                          ))}
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ) : (
            <TableContainer sx={{ mt: 1, overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('orchestration.table.timestamp')}</TableCell>
                    <TableCell>{t('orchestration.table.director')}</TableCell>
                    <TableCell>{t('orchestration.table.agent')}</TableCell>
                    <TableCell>{t('orchestration.table.email')}</TableCell>
                    <TableCell>{t('orchestration.table.hasResult')}</TableCell>
                    <TableCell>{t('orchestration.table.error')}</TableCell>
                    <TableCell align="right">{t('orchestration.table.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((entry, idx) => (
                    <TableRow key={idx} selected={activeTs === entry.timestamp} hover onClick={() => setActiveTs(entry.timestamp)} style={{ cursor: 'pointer' }}>
                      <TableCell>{entry.timestamp}</TableCell>
                      <TableCell>{entry.directorName || entry.director}</TableCell>
                      <TableCell>{entry.agentName || entry.agent}</TableCell>
                      <TableCell>{entry.emailSummary}</TableCell>
                      <TableCell>
                        {entry.result ? (
                          <Chip label={t('labels.yes')} color="success" size="small" />
                        ) : (
                          <Chip label={t('labels.no')} size="small" />
                        )}
                      </TableCell>
                      <TableCell>
                        {entry.error && (typeof entry.error === 'object' || typeof entry.error === 'string')
                          ? <Alert severity="error">{typeof entry.error === 'string' ? entry.error : JSON.stringify(entry.error)}</Alert>
                          : null}
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={t('actions.delete')}>
                          <IconButton size="small" color="error" onClick={() => deleteById(entry.id, entry.timestamp)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('actions.viewTrace') || 'View Trace'}>
                          <IconButton size="small" onClick={() => openTraceFor(entry)}>
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>

        {/* Right pane: tabs for Result and Email */}
        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={t('orchestration.tabs.result')} />
            <Tab label={t('orchestration.tabs.email')} />
          </Tabs>
          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {!activeEntry ? (
              <Typography variant="body2" color="text.secondary">{t('orchestration.detail.selectEvent')}</Typography>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={`diag-detail-tab-${detailTab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
                {detailTab === 0 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>{t('orchestration.detail.resultPayloadDebug')}</Typography>
                    {activeEntry.result ? (
                      <Box>
                        <Button size="small" variant="outlined" onClick={() => setShowResultJson(v => !v)}>
                          {showResultJson ? t('orchestration.detail.hideJson') : t('orchestration.detail.showJson')}
                        </Button>
                        {showResultJson && (
                          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                            {JSON.stringify(activeEntry.result, null, 2)}
                          </Box>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">{t('orchestration.detail.noResult')}</Typography>
                    )}
                    {activeEntry.detail && (
                      <>
                        <Divider sx={{ my: 2 }} />
                        <Typography variant="h6" gutterBottom>{t('orchestration.detail.diagnosticDetail')}</Typography>
                        <Button size="small" variant="outlined" onClick={() => setShowDetailJson(v => !v)}>
                          {showDetailJson ? t('orchestration.detail.hideJson') : t('orchestration.detail.showJson')}
                        </Button>
                        {showDetailJson && (
                          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                            {JSON.stringify(activeEntry.detail, null, 2)}
                          </Box>
                        )}
                      </>
                    )}
                    {activeEntry.error && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">{t('orchestration.detail.errorTitle')}</Typography>
                        <Alert severity="error">{typeof activeEntry.error === 'string' ? activeEntry.error : JSON.stringify(activeEntry.error)}</Alert>
                      </Box>
                    )}
                  </Box>
                )}

                {detailTab === 1 && (
                  <Box>
                    <Typography variant="h6" gutterBottom>{t('orchestration.detail.originalEmail')}</Typography>
                    <Typography variant="subtitle1">{activeEntry.email?.subject || t('results.noSubject')}</Typography>
                    <Typography variant="body2" color="text.secondary">{t('orchestration.detail.from')} {activeEntry.email?.from || ''}</Typography>
                    <Typography variant="body2" color="text.secondary">{t('orchestration.detail.date')} {activeEntry.email?.date || ''}</Typography>
                    {activeEntry.email?.snippet && (
                      <Typography variant="body2" sx={{ mt: 1 }}>{activeEntry.email.snippet}</Typography>
                    )}
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" variant="outlined" onClick={() => setShowEmailRaw(v => !v)}>
                        {showEmailRaw ? t('orchestration.detail.hideRawEmail') : t('orchestration.detail.showRawEmail')}
                      </Button>
                      {showEmailRaw && (
                        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                          {JSON.stringify(activeEntry.email, null, 2)}
                        </Box>
                      )}
                    </Box>
                    {activeEntry.email?.attachments && activeEntry.email.attachments.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">{t('orchestration.detail.attachments')}</Typography>
                        {activeEntry.email.attachments.map((a, i) => (
                          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <a href={a.url || '#'} target="_blank" rel="noopener noreferrer">{a.filename}</a>
                            <Chip label={a.mimeType} size="small" />
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
                </motion.div>
              </AnimatePresence>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
