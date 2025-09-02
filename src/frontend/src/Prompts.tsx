import React, { useState } from 'react';
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
import { useCrudResource } from './hooks/useCrudResource';
import { randomId } from './utils/randomId';

const emptyPrompt: Prompt = {
  id: '',
  name: '',
  messages: [
    { role: 'system', content: '' }
  ]
};

export default function Prompts() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useCookieState<number>('vx_ui.prompts.tab', 0, { maxAge: 60 * 60 * 24 * 365 });
  const { items: prompts, create: createPrompt, update: updatePrompt, remove: removePrompt, error: promptsError, success: promptsSuccess, setError: setPromptsError, setSuccess: setPromptsSuccess } = useCrudResource<Prompt>('/api/prompts');
  const { items: templates, create: createTpl, update: updateTpl, remove: removeTpl, error: templatesError, success: templatesSuccess, setError: setTemplatesError, setSuccess: setTemplatesSuccess } = useCrudResource<TemplateItem>('/api/prompt-templates');
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

  const handleEdit = (prompt: Prompt) => { setEditing(prompt); setOpen(true); };
  const handleDelete = (id: string) => {
    void removePrompt(id, { successMessage: t('prompts.messages.deleted'), errorMessage: t('prompts.errors.failedDelete') });
  };
  const handleSave = () => {
    if (!editing) return;
    if (!editing.name || !editing.messages.length || editing.messages.some(m => !m.content)) {
      setPromptsError(t('prompts.errors.nameAndMessageRequired'));
      return;
    }
    const exists = prompts.find(p => p.id === editing.id);
    const action = exists
      ? updatePrompt(editing.id, editing, { successMessage: t('prompts.messages.updated'), errorMessage: t('prompts.errors.failedSave') })
      : createPrompt(editing, { successMessage: t('prompts.messages.added'), errorMessage: t('prompts.errors.failedSave') });
    action.then(res => {
      if (res) {
        setOpen(false);
        setEditing(null);
      }
    });
  };

  const handleTplEdit = (tpl: TemplateItem) => { setTplEditing(tpl); setTplOpen(true); };
  const handleTplDelete = (id: string) => {
    void removeTpl(id, { successMessage: t('templates.messages.deleted'), errorMessage: t('templates.errors.failedDelete') });
  };
  const handleTplSave = () => {
    if (!tplEditing) return;
    if (!tplEditing.id || !tplEditing.name || !Array.isArray(tplEditing.messages) || tplEditing.messages.some(m => !m.content)) {
      setTemplatesError(t('templates.errors.idNameMessageRequired'));
      return;
    }
    const exists = templates.find(t => t.id === tplEditing.id);
    const action = exists
      ? updateTpl(tplEditing.id, tplEditing, { successMessage: t('templates.messages.updated'), errorMessage: t('templates.errors.failedSave') })
      : createTpl(tplEditing, { successMessage: t('templates.messages.added'), errorMessage: t('templates.errors.failedSave') });
    action.then(res => {
      if (res) {
        setTplOpen(false);
        setTplEditing(null);
      }
    });
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
        error={promptsError}
        templates={templates}
      />
      <TemplateEditDialog
        open={tplOpen}
        editing={tplEditing}
        onChange={t => setTplEditing(t)}
        onClose={() => { setTplOpen(false); setTplEditing(null); }}
        onSave={handleTplSave}
        error={templatesError}
      />
      <Snackbar open={!!promptsError} autoHideDuration={6000} onClose={() => setPromptsError(null)}>
        <Alert severity="error" onClose={() => setPromptsError(null)}>{promptsError}</Alert>
      </Snackbar>
      <Snackbar open={!!promptsSuccess} autoHideDuration={4000} onClose={() => setPromptsSuccess(null)}>
        <Alert severity="success" onClose={() => setPromptsSuccess(null)}>{promptsSuccess}</Alert>
      </Snackbar>
      <Snackbar open={!!templatesError} autoHideDuration={6000} onClose={() => setTemplatesError(null)}>
        <Alert severity="error" onClose={() => setTemplatesError(null)}>{templatesError}</Alert>
      </Snackbar>
      <Snackbar open={!!templatesSuccess} autoHideDuration={4000} onClose={() => setTemplatesSuccess(null)}>
        <Alert severity="success" onClose={() => setTemplatesSuccess(null)}>{templatesSuccess}</Alert>
      </Snackbar>
    </Paper>
  );
}
