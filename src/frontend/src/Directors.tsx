import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Snackbar, Alert, List, ListItem, ListItemText, ListItemSecondaryAction, IconButton as MuiIconButton,
  FormControl, InputLabel, Select, MenuItem, Checkbox, FormGroup, FormControlLabel, Tabs, Tab, Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { OPTIONAL_TOOL_NAMES, CORE_TOOL_NAMES } from '../../shared/tools';
import { AnimatePresence, motion } from 'framer-motion';
import ChatPlayground from './ChatPlayground';
import AgentsPanel from './Agents';
import { useCrudResource } from './hooks/useCrudResource';
import { randomId } from './utils/randomId';
import { Prompt } from '../../shared/types';

interface Director {
  id: string;
  name: string;
  agentIds: string[];
  promptId?: string;
  apiConfigId: string;
  enabledToolCalls?: string[];
}

interface Agent {
  id: string;
  name: string;
  type?: 'openai';
  promptId?: string;
  apiConfigId?: string;
  enabledToolCalls?: Array<'calendar' | 'todo' | 'filesystem' | 'memory'>;
}

const emptyDirector: Director = {
  id: '',
  name: '',
  agentIds: [],
  promptId: '',
  apiConfigId: '',
};

export default function Directors() {
  const { t } = useTranslation('common');
  const OPTIONAL: string[] = OPTIONAL_TOOL_NAMES as any;
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [playgroundConfig, setPlaygroundConfig] = useState<{ apiConfigId: string; initialMessages: any[]; title: string } | null>(null);

  const handleTest = async (id: string) => {
    const director = directors.find(d => d.id === id);
    if (!director) return;
    const api = apiConfigs.find(c => c.id === director.apiConfigId);
    const prompt = prompts.find(p => p.id === director.promptId);
    setPlaygroundConfig({ apiConfigId: director.apiConfigId || '', initialMessages: prompt?.messages || [], title: `${t('directors.test.title')}: ${director.name}` });
    setPlaygroundOpen(true);
  };
  const { items: directors, create, update, remove, error, success, setError, setSuccess } = useCrudResource<Director>('/api/directors');
  const { items: agents } = useCrudResource<Agent>('/api/agents');
  const [editing, setEditing] = useState<Director | null>(null);
  const [open, setOpen] = useState(false);
  const { items: prompts } = useCrudResource<Prompt>('/api/prompts');
  const [apiConfigs, setApiConfigs] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setApiConfigs(data.apiConfigs || []))
      .catch(() => setApiConfigs([]));
  }, []);

  const handleEdit = (director: Director) => { setEditing(director); setTab(0); setOpen(true); };
  const handleDelete = (id: string) => {
    void remove(id, { successMessage: t('directors.messages.deleted'), errorMessage: t('directors.errors.failedDelete') });
  };
  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name) { setError(t('directors.errors.nameRequired')); return; }
    if (!editing.apiConfigId) { setError(t('directors.errors.apiConfigRequired')); return; }
    const exists = directors.find(d => d.id === editing.id);
    const res = exists
      ? await update(editing.id, editing, { successMessage: t('directors.messages.updated'), errorMessage: t('directors.errors.failedSave') })
      : await create(editing, { successMessage: t('directors.messages.added'), errorMessage: t('directors.errors.failedSave') });
    if (res) {
      setOpen(false);
      setEditing(null);
    }
  };

  // Agent assignment logic
  const handleAddAgent = (agentId: string) => {
    if (!editing) return;
    if (!editing.agentIds.includes(agentId))
      setEditing({ ...editing, agentIds: [...editing.agentIds, agentId] });
  };
  const handleRemoveAgent = (agentId: string) => {
    if (!editing) return;
    setEditing({ ...editing, agentIds: editing.agentIds.filter(id => id !== agentId) });
  };
  const moveAgent = (idx: number, dir: -1 | 1) => {
    if (!editing) return;
    const arr = [...editing.agentIds];
    if (idx + dir < 0 || idx + dir >= arr.length) return;
    [arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]];
    setEditing({ ...editing, agentIds: arr });
  };

  // (Agents CRUD is provided by the embedded AgentsPanel to ensure consistent UI)

  return (
    <>
      <Dialog open={testOpen} onClose={() => { setTestOpen(false); setTestResult(null); setTestError(null); setTestLoading(false); }} maxWidth="md" fullWidth>
        <DialogTitle>{t('directors.test.title')}</DialogTitle>
        <DialogContent dividers>
          {testLoading && <Typography>{t('directors.test.testing')}</Typography>}
          {testError && <Alert severity="error">{testError}</Alert>}
          {testResult && !testError && (
            <Box>
              <Alert severity="success">{t('directors.test.succeeded')}</Alert>
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
      {playgroundOpen && playgroundConfig && (
        <ChatPlayground
          open={playgroundOpen}
          title={playgroundConfig.title}
          apiConfigId={playgroundConfig.apiConfigId}
          initialMessages={playgroundConfig.initialMessages as any}
          onClose={() => setPlaygroundOpen(false)}
        />
      )}
      <Box>
      <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h5">{t('directors.title')}</Typography>
          <Button variant="contained" color="primary" onClick={() => { setEditing({ ...emptyDirector, id: randomId() }); setOpen(true); }}>{t('directors.addTitle')}</Button>
        </Box>
        <TableContainer sx={{ mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('directors.table.name')}</TableCell>
              <TableCell>{t('directors.table.agents')}</TableCell>
              <TableCell>{t('directors.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {directors.map(director => (
              <TableRow key={director.id}>
                <TableCell>{director.name}</TableCell>
                <TableCell>{director.agentIds.map(aid => agents.find(a => a.id === aid)?.name || aid).join(', ')}</TableCell>
                <TableCell>
                  <IconButton onClick={() => handleEdit(director)}><EditIcon /></IconButton>
                  <IconButton onClick={() => handleDelete(director.id)}><DeleteIcon /></IconButton>
                  <Button size="small" variant="outlined" sx={{ ml: 1 }} onClick={() => handleTest(director.id)}>{t('directors.test.cta')}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      </Paper>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing && directors.find(d => d.id === editing.id) ? t('directors.editTitle') : t('directors.addTitle')}</DialogTitle>
        <DialogContent dividers>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab label={t('tabs.details') || 'Details'} />
            <Tab label={t('tabs.tools') || 'Tools'} />
            <Tab label={t('tabs.agents') || 'Agents'} />
          </Tabs>
          <Divider sx={{ mb: 2 }} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`dir-tab-${tab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
          {tab === 0 && (
            <>
              <TextField
                label={t('directors.form.name')}
            value={editing?.name || ''}
            onChange={e => setEditing(editing ? { ...editing, name: e.target.value } : null)}
            fullWidth
            margin="normal"
          />
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('directors.form.prompt')}</InputLabel>
            <Select
              value={editing?.promptId || ''}
              label={t('directors.form.prompt')}
              onChange={e => setEditing(editing ? { ...editing, promptId: e.target.value } : null)}
            >
              <MenuItem value="">{t('labels.none')}</MenuItem>
              {prompts.map(p => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('directors.form.apiConfig')}</InputLabel>
            <Select
              value={editing?.apiConfigId || ''}
              label={t('directors.form.apiConfig')}
              onChange={e => setEditing(editing ? { ...editing, apiConfigId: e.target.value } : null)}
              required
            >
              <MenuItem value=""><em>{t('labels.none')}</em></MenuItem>
              {apiConfigs.map(cfg => (
                <MenuItem key={cfg.id} value={cfg.id}>{cfg.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
            </>
          )}
          {tab === 1 && (
            <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle2">{t('directors.form.optionalTools')}</Typography>
            <FormGroup row>
              {OPTIONAL.map(tool => (
                <FormControlLabel
                  key={tool}
                  control={
                    <Checkbox
                      checked={editing ? ((editing.enabledToolCalls ? editing.enabledToolCalls.includes(tool) : true)) : false}
                      onChange={(_, checked) => {
                        if (!editing) return;
                        const full = OPTIONAL;
                        const set = new Set(editing.enabledToolCalls ?? full);
                        if (checked) set.add(tool); else set.delete(tool);
                        const arr = Array.from(set) as Array<'calendar' | 'todo' | 'filesystem' | 'memory'>;
                        const nextEnabled = arr.length === full.length ? undefined : arr;
                        setEditing({ ...editing, enabledToolCalls: nextEnabled as any });
                      }}
                    />
                  }
                  label={tool}
                />
              ))}
            </FormGroup>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2">Mandatory tools</Typography>
            <FormGroup row>
              {(CORE_TOOL_NAMES as readonly string[]).map(name => (
                <FormControlLabel key={name} control={<Checkbox checked disabled />} label={name} />
              ))}
            </FormGroup>
          </Box>
          )}
          {tab === 2 && (
            <>
          <Typography variant="subtitle1" sx={{ mt: 1 }}>{t('directors.form.assignedAgents')}</Typography>
          <List>
            {editing?.agentIds.map((aid, idx) => {
              const agent = agents.find(a => a.id === aid);
              return agent ? (
                <ListItem key={aid}>
                  <ListItemText primary={agent.name} />
                  <ListItemSecondaryAction>
                    <MuiIconButton edge="end" onClick={() => moveAgent(idx, -1)} disabled={idx === 0}><ArrowUpwardIcon /></MuiIconButton>
                    <MuiIconButton edge="end" onClick={() => moveAgent(idx, 1)} disabled={idx === editing.agentIds.length - 1}><ArrowDownwardIcon /></MuiIconButton>
                    <MuiIconButton edge="end" onClick={() => handleRemoveAgent(aid)}><DeleteIcon /></MuiIconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ) : null;
            })}
          </List>
          <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('directors.form.addAgent')}</Typography>
          <List>
            {agents.filter(a => !editing?.agentIds.includes(a.id)).map(agent => (
              <ListItem button key={agent.id} onClick={() => handleAddAgent(agent.id)}>
                <ListItemText primary={agent.name} />
              </ListItem>
            ))}
          </List>
            </>
          )}
            </motion.div>
          </AnimatePresence>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('actions.cancel')}</Button>
          <Button onClick={handleSave} variant="contained">{t('actions.save')}</Button>
        </DialogActions>
      </Dialog>
      {/* Embedded Agents panel reuses the original component for consistent UX */}
      <Box sx={{ mt: 2 }}>
        <AgentsPanel />
      </Box>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Box>
    </>
  );
}
