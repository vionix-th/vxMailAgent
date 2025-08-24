import React, { useEffect, useState } from 'react';
import {
  Box, Button, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Snackbar, Alert, Tabs, Tab
} from '@mui/material';
import PromptEditDialog from './PromptEditDialog';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';

import { Prompt, PromptMessage } from '../../shared/types';
import TemplateEditDialog, { TemplateItem } from './TemplateEditDialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useCookieState } from './hooks/useCookieState';

const emptyPrompt: Prompt = {
  id: '',
  name: '',
  messages: [
    { role: 'system', content: '' }
  ]
};

function randomId() { return Math.random().toString(36).slice(2, 10); }

export default function Prompts() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useCookieState<number>('vx_ui.prompts.tab', 0, { maxAge: 60 * 60 * 24 * 365 });
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [tplEditing, setTplEditing] = useState<TemplateItem | null>(null);
  // For message editing UI
  const handleMsgChange = (idx: number, field: 'role' | 'content', value: string) => {
    if (!editing) return;
    const msgs = Array.isArray(editing.messages) ? editing.messages : [];
    const newMsgs = msgs.map((m, i) => i === idx ? { ...m, [field]: value } : m);
    setEditing({ ...editing, messages: newMsgs });
  };
  const handleMsgAdd = () => {
    if (!editing) return;
    const msgs = Array.isArray(editing.messages) ? editing.messages : [];
    setEditing({ ...editing, messages: [...msgs, { role: 'user', content: '' }] });
  };
  const handleMsgDelete = (idx: number) => {
    if (!editing) return;
    const msgs = Array.isArray(editing.messages) ? editing.messages : [];
    setEditing({ ...editing, messages: msgs.filter((_, i) => i !== idx) });
  };
  const handleMsgMove = (idx: number, dir: -1 | 1) => {
    if (!editing) return;
    const msgs = Array.isArray(editing.messages) ? [...editing.messages] : [];
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= msgs.length) return;
    [msgs[idx], msgs[tgt]] = [msgs[tgt], msgs[idx]];
    setEditing({ ...editing, messages: msgs });
  };

  const [open, setOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(setPrompts).catch(() => setError(t('prompts.errors.failedLoadPrompts')));
    fetch('/api/prompt-templates').then(r => r.json()).then(setTemplates).catch(() => setError(t('templates.errors.failedLoadTemplates')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEdit = (prompt: Prompt) => { setEditing(prompt); setOpen(true); };
  const handleDelete = (id: string) => {
    fetch(`/api/prompts/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setPrompts(prompts.filter(p => p.id !== id)); setSuccess(t('prompts.messages.deleted')); })
      .catch(() => setError(t('prompts.errors.failedDelete')));
  };
  const handleSave = () => {
    if (!editing) return;
    if (!editing.name || !editing.messages.length || editing.messages.some(m => !m.content)) {
      setError(t('prompts.errors.nameAndMessageRequired'));
      return;
    }
    const method = prompts.find(p => p.id === editing.id) ? 'PUT' : 'POST';
    const url = method === 'POST' ? '/api/prompts' : `/api/prompts/${editing.id}`;
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(method === 'POST' ? { ...editing, id: randomId() } : editing),
    })
      .then(r => r.json())
      .then(() => {
        setOpen(false);
        setEditing(null);
        fetch('/api/prompts').then(r => r.json()).then(setPrompts);
        setSuccess(method === 'POST' ? t('prompts.messages.added') : t('prompts.messages.updated'));
      })
      .catch(() => setError(t('prompts.errors.failedSave')));
  };

  const handleTplEdit = (tpl: TemplateItem) => { setTplEditing(tpl); setTplOpen(true); };
  const handleTplDelete = (id: string) => {
    fetch(`/api/prompt-templates/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setTemplates(templates.filter(t => t.id !== id)); setSuccess(t('templates.messages.deleted')); })
      .catch(() => setError(t('templates.errors.failedDelete')));
  };
  const handleTplSave = () => {
    if (!tplEditing) return;
    if (!tplEditing.id || !tplEditing.name || !Array.isArray(tplEditing.messages) || tplEditing.messages.some(m => !m.content)) {
      setError(t('templates.errors.idNameMessageRequired'));
      return;
    }
    const exists = templates.find(t => t.id === tplEditing.id);
    const method = exists ? 'PUT' : 'POST';
    const url = exists ? `/api/prompt-templates/${tplEditing.id}` : '/api/prompt-templates';
    const payload = exists ? tplEditing : { ...tplEditing };
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(() => {
        setTplOpen(false);
        setTplEditing(null);
        fetch('/api/prompt-templates').then(r => r.json()).then(setTemplates);
        setSuccess(exists ? t('templates.messages.updated') : t('templates.messages.added'));
      })
      .catch(() => setError(t('templates.errors.failedSave')));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5">{t('prompts.title')}</Typography>
      </Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 1 }}>
        <Tab label={t('prompts.tabs.prompts')} />
        <Tab label={t('prompts.tabs.templates')} />
      </Tabs>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`prompts-tab-${tab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      {tab === 0 && (
        <>
          <Button variant="contained" color="primary" onClick={() => { setEditing({ ...emptyPrompt, id: randomId() }); setOpen(true); }}>{t('prompts.buttons.addPrompt')}</Button>
          <TableContainer sx={{ mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('prompts.table.name')}</TableCell>
                  <TableCell>{t('prompts.table.messages')}</TableCell>
                  <TableCell>{t('prompts.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {prompts.map(prompt => (
                  <TableRow key={prompt.id}>
                    <TableCell>{prompt.name}</TableCell>
                    <TableCell>
                      <pre style={{ margin: 0, fontSize: 12 }}>
                        {(prompt.messages || []).map((m, i) => {
                          const c = m.content ?? '';
                          return `[${m.role}] ${c.slice(0, 40)}${c.length > 40 ? '…' : ''}`;
                        }).join('\n')}
                      </pre>
                    </TableCell>
                    <TableCell>
                      <IconButton onClick={() => handleEdit(prompt)}><EditIcon /></IconButton>
                      <IconButton onClick={() => handleDelete(prompt.id)}><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {tab === 1 && (
        <>
          <Button variant="contained" color="primary" onClick={() => { setTplEditing({ id: randomId(), name: '', messages: [{ role: 'system', content: '' }] }); setTplOpen(true); }}>{t('templates.buttons.addTemplate')}</Button>
          <TableContainer sx={{ mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('templates.table.id')}</TableCell>
                  <TableCell>{t('templates.table.name')}</TableCell>
                  <TableCell>{t('templates.table.messages')}</TableCell>
                  <TableCell>{t('templates.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.map(tpl => (
                  <TableRow key={tpl.id}>
                    <TableCell>{tpl.id}</TableCell>
                    <TableCell>{tpl.name}</TableCell>
                    <TableCell>
                      <pre style={{ margin: 0, fontSize: 12 }}>
                        {(tpl.messages || []).map((m, i) => {
                          const c = m.content ?? '';
                          return `[${m.role}] ${c.slice(0, 40)}${c.length > 40 ? '…' : ''}`;
                        }).join('\n')}
                      </pre>
                    </TableCell>
                    <TableCell>
                      <IconButton onClick={() => handleTplEdit(tpl)} title={t('templates.tooltips.edit')}><EditIcon /></IconButton>
                      <IconButton
                        onClick={() => handleTplDelete(tpl.id)}
                        disabled={tpl.id === 'prompt_optimizer'}
                        title={tpl.id === 'prompt_optimizer' ? t('templates.tooltips.cannotDeleteSystem') : t('templates.tooltips.delete')}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
        </motion.div>
      </AnimatePresence>
      <PromptEditDialog
        open={open}
        editing={editing}
        onChange={p => setEditing(p)}
        onClose={() => { setOpen(false); setEditing(null); }}
        onSave={handleSave}
        error={error}
        templates={templates}
      />
      <TemplateEditDialog
        open={tplOpen}
        editing={tplEditing}
        onChange={t => setTplEditing(t)}
        onClose={() => { setTplOpen(false); setTplEditing(null); }}
        onSave={handleTplSave}
        error={error}
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Paper>
  );
}
