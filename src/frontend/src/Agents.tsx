import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Snackbar, Alert,
  Checkbox, FormGroup, FormControlLabel, Tabs, Tab, Divider
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ChatPlayground from './ChatPlayground';

import { Agent } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES, CORE_TOOL_NAMES } from '../../shared/tools';

interface Prompt { id: string; name: string; }

const emptyAgent: Agent = {
  id: '',
  name: '',
  type: 'openai',
  promptId: '',
  apiConfigId: '',
};

function randomId() { return Math.random().toString(36).slice(2, 10); }

export default function Agents() {
  const { t } = useTranslation('common');
  const OPTIONAL: string[] = OPTIONAL_TOOL_NAMES as any;
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [playgroundConfig, setPlaygroundConfig] = useState<{ apiConfigId: string; initialMessages: any[]; title: string } | null>(null);

  const handleTest = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    const api = apiConfigs.find(c => c.id === agent.apiConfigId);
    const prompt = prompts.find(p => p.id === agent.promptId);
    setPlaygroundConfig({ apiConfigId: agent.apiConfigId || '', initialMessages: prompt?.messages || [], title: `${t('agents.test.title')}: ${agent.name}` });
    setPlaygroundOpen(true);
  };
  const [agents, setAgents] = useState<Agent[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConfigs, setApiConfigs] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setApiConfigs(data.apiConfigs || []))
      .catch(() => setApiConfigs([]));
  }, []);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(setAgents).catch(() => setError(t('agents.errors.failedLoadAgents')));
    fetch('/api/prompts').then(r => r.json()).then(setPrompts).catch(() => setError(t('agents.errors.failedLoadPrompts')));
  }, []);

  const handleEdit = (agent: Agent) => { setEditing(agent); setTab(0); setOpen(true); };
  const handleDelete = (id: string) => {
    fetch(`/api/agents/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setAgents(agents.filter(a => a.id !== id)); setSuccess(t('agents.messages.deleted')); })
      .catch(() => setError(t('agents.errors.failedDelete')));
  };
  const handleSave = () => {
    if (!editing) return;
    if (!editing.name) {
      setError(t('agents.errors.nameRequired'));
      return;
    }
    if (!editing.apiConfigId) {
      setError(t('agents.errors.apiConfigRequired'));
      return;
    }
    const method = agents.find(a => a.id === editing.id) ? 'PUT' : 'POST';
    const url = method === 'POST' ? '/api/agents' : `/api/agents/${editing.id}`;
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(method === 'POST' ? { ...editing, id: randomId() } : editing),
    })
      .then(r => r.json())
      .then(() => {
        setOpen(false);
        setEditing(null);
        fetch('/api/agents').then(r => r.json()).then(setAgents);
        setSuccess(method === 'POST' ? t('agents.messages.added') : t('agents.messages.updated'));
      })
      .catch(() => setError(t('agents.errors.failedSave')));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5">{t('agents.title')}</Typography>
        <Button variant="contained" color="primary" onClick={() => { setEditing({ ...emptyAgent, id: randomId() }); setOpen(true); }}>{t('agents.addTitle')}</Button>
      </Box>
      <TableContainer sx={{ mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('agents.table.name')}</TableCell>
              <TableCell>{t('agents.table.type')}</TableCell>
              <TableCell>{t('agents.table.prompt')}</TableCell>
              <TableCell>{t('agents.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agents.map(agent => (
              <TableRow key={agent.id}>
                <TableCell>{agent.name}</TableCell>
                <TableCell>{agent.type}</TableCell>
                <TableCell>{prompts.find(p => p.id === agent.promptId)?.name || agent.promptId}</TableCell>
                <TableCell>
                  <IconButton onClick={() => handleEdit(agent)}><EditIcon /></IconButton>
                  <IconButton onClick={() => handleDelete(agent.id)}><DeleteIcon /></IconButton>
                  <Button size="small" variant="outlined" sx={{ ml: 1 }} onClick={() => handleTest(agent.id)}>{t('agents.test.cta')}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={testOpen} onClose={() => setTestOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('agents.test.title')}</DialogTitle>
        <DialogContent dividers>
          {testLoading && <Typography>{t('agents.test.testing')}</Typography>}
          {testError && <Alert severity="error">{testError}</Alert>}
          {testResult && !testError && (
            <Box>
              <Alert severity="success">{t('agents.test.succeeded')}</Alert>
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
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing && agents.find(a => a.id === editing.id) ? t('agents.editTitle') : t('agents.addTitle')}</DialogTitle>
        <DialogContent dividers>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab label={t('tabs.details')} />
            <Tab label={t('tabs.tools')} />
          </Tabs>
          <Divider sx={{ mb: 2 }} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`agent-tab-${tab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
          {tab === 0 && (
            <>
              <TextField
                margin="dense"
                label={t('agents.form.name')}
                fullWidth
                value={editing?.name || ''}
                onChange={e => setEditing(editing ? { ...editing, name: e.target.value } : null)}
              />
              <TextField
                margin="dense"
                label={t('agents.form.type')}
                fullWidth
                value={editing?.type || 'openai'}
                InputProps={{ readOnly: true }}
              />
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>{t('agents.form.prompt')}</InputLabel>
                <Select
                  value={editing?.promptId || ''}
                  label={t('agents.form.prompt')}
                  onChange={e => setEditing(editing ? { ...editing, promptId: e.target.value } : null)}
                >
                  <MenuItem value="">{t('labels.none')}</MenuItem>
                  {prompts.map(p => (
                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>{t('agents.form.apiConfig')}</InputLabel>
                <Select
                  value={editing?.apiConfigId || ''}
                  label={t('agents.form.apiConfig')}
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
              <Typography variant="subtitle2">{t('agents.form.optionalTools')}</Typography>
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
                          const arr = Array.from(set) as string[];
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
            </motion.div>
          </AnimatePresence>
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
