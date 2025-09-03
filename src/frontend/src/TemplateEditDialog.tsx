import React from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, Divider, Stack, Alert
} from '@mui/material';
import { PromptMessage } from '../../shared/types';
import { useTranslation } from 'react-i18next';
import MessageListEditor from './components/MessageListEditor';

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

  const handleMessagesChange = (messages: PromptMessage[]) => {
    if (!tpl) return;
    onChange({ ...tpl, messages });
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
          {tpl && (
            <MessageListEditor
              messages={tpl.messages}
              onChange={handleMessagesChange}
              config={{
                defaultRole: 'system',
                minMessages: 1,
                showVariableInsert: false,
                translationPrefix: 'templates.dialog'
              }}
            />
          )}
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
