import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, Alert, FormControl, InputLabel, MenuItem, Select, Tooltip, Divider, Stack, Tabs, Tab
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { Prompt, PromptMessage } from '../../shared/types';
import { useTranslation } from 'react-i18next';
import { useCookieState } from './hooks/useCookieState';
import { apiFetch } from './utils/http';
import MessageListEditor from './components/MessageListEditor';

interface PromptEditDialogProps {
  open: boolean;
  editing: Prompt | null;
  onChange: (p: Prompt) => void;
  onClose: () => void;
  onSave: () => void;
  error?: string | null;
  templates?: Array<{ id: string; name: string; messages: PromptMessage[] }>;
}

export default function PromptEditDialog({ open, editing, onChange, onClose, onSave, error, templates }: PromptEditDialogProps) {
  // Defensive: ensure editing is always a Prompt with array messages
  const prompt = editing && Array.isArray(editing.messages) ? editing : null;
  const { t } = useTranslation('common');

  const [optimizing, setOptimizing] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistNotes, setAssistNotes] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [including, setIncluding] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [tab, setTab] = useCookieState<number>('vx_ui.prompts.dialog.tab', 0, { maxAge: 60 * 60 * 24 * 365 });

  const handleMessagesChange = (messages: PromptMessage[]) => {
    if (!prompt) return;
    onChange({ ...prompt, messages });
  };

  const handleOptimize = async () => {
    if (!prompt) return;
    setAssistError(null);
    setAssistNotes(null);
    setOptimizing(true);
    try {
      const payload: any = { prompt };
      if (target) payload.target = target;
      if (including) payload.including = including;
      const data = await apiFetch('/api/prompts/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (data?.improved?.messages && Array.isArray(data.improved.messages)) {
        onChange({ ...prompt, messages: data.improved.messages });
        if (data?.notes) setAssistNotes(String(data.notes));
      } else {
        setAssistError(t('prompts.dialog.assistant.errors.noImprovements'));
      }
    } catch (e: any) {
      setAssistError(String(e?.message || e));
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {prompt && prompt.id ? t('prompts.dialog.editTitle') : t('prompts.dialog.addTitle')}
        <Tooltip title={t('prompts.dialog.assistant.tooltip')}>
          <InfoOutlinedIcon sx={{ ml: 1, verticalAlign: 'middle', color: 'action.active' }} />
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
            <Tab label={t('prompts.dialog.tabs.edit')} />
            <Tab label={t('prompts.dialog.tabs.generate')} />
          </Tabs>
        </Box>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`prompt-dialog-tab-${tab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
        {tab === 0 && (
          <Stack spacing={3}>
            {templates && templates.length > 0 && (
              <Box display="flex" gap={2}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>{t('prompts.dialog.form.template')}</InputLabel>
                  <Select
                    value={selectedTemplateId}
                    label={t('prompts.dialog.form.template')}
                    onChange={e => {
                      const id = String(e.target.value);
                      setSelectedTemplateId(id);
                      if (prompt && templates) {
                        const tpl = templates.find(t => t.id === id);
                        if (tpl && Array.isArray(tpl.messages)) {
                          onChange({ ...prompt, messages: tpl.messages });
                        }
                      }
                    }}
                  >
                    {templates.map(t => (
                      <MenuItem key={t.id} value={t.id}>{t.name} ({t.id})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}
            <Box display="flex" gap={2} alignItems="center">
              <TextField
                label={t('prompts.dialog.form.name')}
                value={prompt?.name || ''}
                onChange={e => prompt && onChange({ ...prompt, name: e.target.value })}
                fullWidth
                autoFocus
              />
            </Box>
            <Divider>{t('prompts.dialog.sections.promptMessages')}</Divider>
            {prompt && (
              <MessageListEditor
                messages={prompt.messages}
                onChange={handleMessagesChange}
                config={{
                  defaultRole: 'user',
                  minMessages: 1,
                  showVariableInsert: true,
                  translationPrefix: 'prompts.dialog'
                }}
              />
            )}
            <Divider>{t('prompts.dialog.sections.preview')}</Divider>
            <Box sx={{ bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>{t('prompts.dialog.sections.messagesRaw')}</Typography>
              <pre style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{JSON.stringify(prompt?.messages, null, 2)}</pre>
            </Box>
          </Stack>
        )}

        {tab === 1 && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">{t('prompts.dialog.optimize.info')}</Typography>
            <Box display="flex" gap={2} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>{t('prompts.dialog.optimize.target.label')}</InputLabel>
                <Select
                  value={target}
                  label={t('prompts.dialog.optimize.target.label')}
                  onChange={e => setTarget(String(e.target.value))}
                >
                  <MenuItem value="">{t('prompts.dialog.optimize.target.placeholder')}</MenuItem>
                  <MenuItem value="director">{t('prompts.dialog.optimize.target.director')}</MenuItem>
                  <MenuItem value="agent">{t('prompts.dialog.optimize.target.agent')}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>{t('prompts.dialog.optimize.including.label')}</InputLabel>
                <Select
                  value={including}
                   label={t('prompts.dialog.optimize.including.label')}
                  onChange={e => setIncluding(String(e.target.value))}
                >
                  <MenuItem value="">{t('prompts.dialog.optimize.including.none')}</MenuItem>
                  <MenuItem value="optional">{t('prompts.dialog.optimize.including.optional')}</MenuItem>
                  <MenuItem value="all">{t('prompts.dialog.optimize.including.all')}</MenuItem>
                </Select>
              </FormControl>
              <Button onClick={handleOptimize} startIcon={<AutoFixHighIcon />} disabled={!prompt || optimizing || !target} variant="outlined">
                {optimizing ? t('prompts.dialog.optimize.optimizing') : t('prompts.dialog.optimize.cta')}
              </Button>
            </Box>
            {assistNotes && (
              <Alert severity="info">
                <Typography variant="subtitle2" gutterBottom>{t('prompts.dialog.optimize.notesTitle')}</Typography>
                <div style={{ whiteSpace: 'pre-wrap' }}>{assistNotes}</div>
              </Alert>
            )}
            {assistError && <Alert severity="error">{assistError}</Alert>}
          </Stack>
        )}
          </motion.div>
        </AnimatePresence>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button onClick={onSave} variant="contained">{t('actions.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
