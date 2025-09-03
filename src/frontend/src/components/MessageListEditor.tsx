import React from 'react';
import {
  Box, Button, TextField, Typography, IconButton, FormControl, InputLabel, MenuItem, Select, Stack
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AddIcon from '@mui/icons-material/Add';
import { PromptMessage } from '../../../shared/types';
import { useTranslation } from 'react-i18next';
import VariableInsertMenu from '../VariableInsertMenu';

export interface MessageListEditorConfig {
  /** Default role for new messages */
  defaultRole: 'system' | 'user' | 'assistant';
  /** Maximum number of messages allowed (0 = unlimited) */
  maxMessages?: number;
  /** Minimum number of messages required */
  minMessages?: number;
  /** Show variable insert menu for content fields */
  showVariableInsert?: boolean;
  /** Translation key prefix for labels */
  translationPrefix: string;
}

interface MessageListEditorProps {
  messages: PromptMessage[];
  onChange: (messages: PromptMessage[]) => void;
  config: MessageListEditorConfig;
}

export default function MessageListEditor({ messages, onChange, config }: MessageListEditorProps) {
  const { t } = useTranslation('common');
  const {
    defaultRole,
    maxMessages = 0,
    minMessages = 1,
    showVariableInsert = false,
    translationPrefix
  } = config;

  React.useEffect(() => {
    if (messages.some(m => !m.id)) {
      onChange(messages.map(m => (m.id ? m : { ...m, id: crypto.randomUUID() })));
    }
  }, [messages, onChange]);

  const handleMsgChange = (id: string, field: 'role' | 'content', value: string) => {
    const newMessages = messages.map(m => m.id === id ? { ...m, [field]: value } : m);
    onChange(newMessages);
  };

  const handleMsgAdd = () => {
    if (maxMessages > 0 && messages.length >= maxMessages) return;
    onChange([...messages, { id: crypto.randomUUID(), role: defaultRole, content: '' }]);
  };

  const handleMsgDelete = (id: string) => {
    if (messages.length <= minMessages) return;
    onChange(messages.filter(m => m.id !== id));
  };

  const handleMsgMove = (idx: number, dir: -1 | 1) => {
    const newMessages = [...messages];
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= newMessages.length) return;
    [newMessages[idx], newMessages[tgt]] = [newMessages[tgt], newMessages[idx]];
    onChange(newMessages);
  };

  const canDelete = messages.length > minMessages;
  const canAdd = maxMessages === 0 || messages.length < maxMessages;

  return (
    <Stack spacing={2}>
      {messages.length > 0 ? (
        messages.map((msg, idx) => (
          <Box key={msg.id} display="flex" alignItems="flex-start" gap={2}>
            <FormControl sx={{ minWidth: 120 }} size="small">
              <InputLabel>{t(`${translationPrefix}.form.role`)}</InputLabel>
              <Select
                value={msg.role}
                label={t(`${translationPrefix}.form.role`)}
                onChange={e => handleMsgChange(msg.id!, 'role', e.target.value as any)}
              >
                <MenuItem value="system">system</MenuItem>
                <MenuItem value="user">user</MenuItem>
                <MenuItem value="assistant">assistant</MenuItem>
              </Select>
            </FormControl>
            <Box sx={{ flex: 1, display: 'flex', gap: 1 }}>
              <TextField
                label={t(`${translationPrefix}.form.content`)}
                fullWidth
                multiline
                minRows={2}
                value={msg.content ?? ''}
                onChange={e => handleMsgChange(msg.id!, 'content', e.target.value)}
                inputProps={{
                  style: { fontFamily: 'monospace' },
                  name: showVariableInsert ? `message-content-${msg.id}` : undefined
                }}
              />
              {showVariableInsert && (
                <VariableInsertMenu
                  idx={idx}
                  msg={msg}
                  onInsert={(variable: string) => {
                    const textarea = document.querySelector(
                      `textarea[name='message-content-${msg.id}']`
                    ) as HTMLTextAreaElement | null;
                    const base = msg.content ?? '';
                    let insertPos = textarea && textarea.selectionStart != null ? textarea.selectionStart : base.length;
                    const before = base.slice(0, insertPos);
                    const after = base.slice(insertPos);
                    handleMsgChange(msg.id!, 'content', before + variable + after);
                    setTimeout(() => {
                      if (textarea) {
                        textarea.focus();
                        const pos = insertPos + variable.length;
                        textarea.setSelectionRange(pos, pos);
                      }
                    }, 0);
                  }}
                />
              )}
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <IconButton
                onClick={() => handleMsgMove(idx, -1)}
                disabled={idx === 0}
                size="small"
              >
                <ArrowUpwardIcon />
              </IconButton>
              <IconButton
                onClick={() => handleMsgMove(idx, 1)}
                disabled={idx === messages.length - 1}
                size="small"
              >
                <ArrowDownwardIcon />
              </IconButton>
              <IconButton
                onClick={() => handleMsgDelete(msg.id!)}
                disabled={!canDelete}
                size="small"
                color="error"
              >
                <DeleteIcon />
              </IconButton>
            </Stack>
          </Box>
        ))
      ) : (
        <Typography color="text.secondary">
          {t(`${translationPrefix}.emptyNoMessages`)}
        </Typography>
      )}
      <Button
        startIcon={<AddIcon />}
        variant="outlined"
        onClick={handleMsgAdd}
        disabled={!canAdd}
        sx={{ alignSelf: 'flex-start' }}
      >
        {t(`${translationPrefix}.addMessage`)}
      </Button>
    </Stack>
  );
}
