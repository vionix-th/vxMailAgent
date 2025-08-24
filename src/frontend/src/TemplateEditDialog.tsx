import React from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, IconButton, FormControl, InputLabel, MenuItem, Select, Divider, Stack, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AddIcon from '@mui/icons-material/Add';
import { PromptMessage } from '../../shared/types';
import { useTranslation } from 'react-i18next';

export interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  messages: PromptMessage[];
}

interface TemplateEditDialogProps {
  open: boolean;
  editing: TemplateItem | null;
  onChange: (t: TemplateItem) => void;
  onClose: () => void;
  onSave: () => void;
  error?: string | null;
}

export default function TemplateEditDialog({ open, editing, onChange, onClose, onSave, error }: TemplateEditDialogProps) {
  const tpl = editing && Array.isArray(editing.messages) ? editing : null;
  const { t } = useTranslation('common');

  const handleMsgChange = (idx: number, field: 'role' | 'content', value: string) => {
    if (!tpl) return;
    const msgs = tpl.messages.map((m, i) => i === idx ? { ...m, [field]: value } : m);
    onChange({ ...tpl, messages: msgs });
  };
  const handleMsgAdd = () => { if (tpl) onChange({ ...tpl, messages: [...tpl.messages, { role: 'system', content: '' }] }); };
  const handleMsgDelete = (idx: number) => { if (tpl) onChange({ ...tpl, messages: tpl.messages.filter((_, i) => i !== idx) }); };
  const handleMsgMove = (idx: number, dir: -1 | 1) => {
    if (!tpl) return;
    const msgs = [...tpl.messages];
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= msgs.length) return;
    [msgs[idx], msgs[tgt]] = [msgs[tgt], msgs[idx]];
    onChange({ ...tpl, messages: msgs });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{tpl && tpl.id ? t('templates.dialog.editTitle') : t('templates.dialog.addTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          <Box display="flex" gap={2}>
            <TextField label={t('templates.dialog.form.name')} value={tpl?.name || ''} onChange={e => tpl && onChange({ ...tpl, name: e.target.value })} fullWidth autoFocus />
          </Box>
          <TextField label={t('templates.dialog.form.description')} value={tpl?.description || ''} onChange={e => tpl && onChange({ ...tpl, description: e.target.value })} fullWidth multiline minRows={2} />
          <Divider>{t('templates.dialog.sections.templateMessages')}</Divider>
          <Stack spacing={2}>
            {tpl?.messages?.length ? tpl.messages.map((msg, idx) => (
              <Box key={idx} display="flex" alignItems="flex-start" gap={2}>
                <FormControl sx={{ minWidth: 120 }} size="small">
                  <InputLabel>{t('templates.dialog.form.role')}</InputLabel>
                  <Select value={msg.role} label={t('templates.dialog.form.role')} onChange={e => handleMsgChange(idx, 'role', e.target.value as any)}>
                    <MenuItem value="system">system</MenuItem>
                    <MenuItem value="user">user</MenuItem>
                    <MenuItem value="assistant">assistant</MenuItem>
                  </Select>
                </FormControl>
                <TextField label={t('templates.dialog.form.content')} fullWidth multiline minRows={2} value={msg.content} onChange={e => handleMsgChange(idx, 'content', e.target.value)} inputProps={{ style: { fontFamily: 'monospace' } }} />
                <Stack direction="row" spacing={0.5}>
                  <IconButton onClick={() => handleMsgMove(idx, -1)} disabled={idx === 0} size="small"><ArrowUpwardIcon /></IconButton>
                  <IconButton onClick={() => handleMsgMove(idx, 1)} disabled={idx === (tpl.messages.length - 1)} size="small"><ArrowDownwardIcon /></IconButton>
                  <IconButton onClick={() => handleMsgDelete(idx)} disabled={tpl.messages.length === 1} size="small" color="error"><DeleteIcon /></IconButton>
                </Stack>
              </Box>
            )) : <Typography color="text.secondary">{t('templates.dialog.emptyNoMessages')}</Typography>}
            <Button startIcon={<AddIcon />} variant="outlined" onClick={handleMsgAdd} sx={{ alignSelf: 'flex-start' }}>{t('templates.dialog.addMessage')}</Button>
          </Stack>
          <Divider>{t('templates.dialog.sections.preview')}</Divider>
          <Box sx={{ bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t('templates.dialog.sections.messagesRaw')}</Typography>
            <pre style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{JSON.stringify(tpl?.messages || [], null, 2)}</pre>
          </Box>
        </Stack>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button onClick={onSave} variant="contained">{t('actions.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
