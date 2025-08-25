import React from 'react';
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, IconButton, FormControl, InputLabel, Select, MenuItem, Typography, Divider, Alert, Tooltip, Checkbox, FormControlLabel, Tabs, Tab } from '@mui/material';
import { CORE_TOOL_NAMES, OPTIONAL_TOOL_NAMES } from '../../shared/tools';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { PromptMessage } from '../../shared/types';

type Role = 'system' | 'user' | 'assistant';

export interface ChatPlaygroundProps {
  open: boolean;
  title: string;
  apiConfigId: string;
  initialMessages: PromptMessage[];
  onClose: () => void;
}

const emptyMessage: PromptMessage = { role: 'user', content: '' } as any;

/** Dialog for experimenting with chat prompts and tool calls. */
export default function ChatPlayground({ open, title, apiConfigId, initialMessages, onClose }: ChatPlaygroundProps) {
  const [messages, setMessages] = React.useState<PromptMessage[]>(initialMessages || []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastResponse, setLastResponse] = React.useState<any | null>(null);
  const [includeTools, setIncludeTools] = React.useState<string[]>([]);
  const [includeCoreTools, setIncludeCoreTools] = React.useState<string[]>(() => Array.from(CORE_TOOL_NAMES as readonly string[]));
  const [toolChoice, setToolChoice] = React.useState<'auto'|'none'|''>('auto');
  const [tab, setTab] = React.useState<number>(0); // 0=Thread, 1=Functions, 2=Last Response, 3=Raw

  React.useEffect(() => {
    // Reset thread when apiConfig or initial changes
    setMessages(initialMessages || []);
    setError(null);
    setLastResponse(null);
  }, [open, apiConfigId, JSON.stringify(initialMessages)]);

  const updateMsg = (idx: number, patch: Partial<PromptMessage>) => {
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };
  const moveMsg = (idx: number, dir: -1 | 1) => {
    setMessages((prev) => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  };
  const deleteMsg = (idx: number) => setMessages((prev) => prev.filter((_, i) => i !== idx));
  const addMsg = (role: Role) => setMessages((prev) => [...prev, { ...(emptyMessage as any), role, content: '' }]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setLastResponse(null);
    try {
      const res = await fetch('/api/test/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiConfigId, messages, includeTools, includeCoreTools, toolChoice: toolChoice === '' ? undefined : toolChoice }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data?.error ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : 'Request failed');
      } else {
        setLastResponse(data);
        const assistant = data?.response?.choices?.[0]?.message;
        if (assistant) setMessages((prev) => [...prev, { role: 'assistant', content: assistant.content ?? '' } as any]);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Thread" />
              <Tab label="Functions" />
              <Tab label="Last response" />
              <Tab label="Raw" />
            </Tabs>
          </Box>
          {tab === 0 && messages.map((m, idx) => (
            <Box key={idx} display="flex" alignItems="flex-start" gap={1}>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Role</InputLabel>
                <Select value={m.role as Role} label="Role" onChange={(e) => updateMsg(idx, { role: e.target.value as any })}>
                  <MenuItem value="system">system</MenuItem>
                  <MenuItem value="user">user</MenuItem>
                  <MenuItem value="assistant">assistant</MenuItem>
                </Select>
              </FormControl>
              <TextField fullWidth multiline minRows={2} value={m.content ?? ''} onChange={(e) => updateMsg(idx, { content: e.target.value })} placeholder="Message content" />
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Move up"><span><IconButton size="small" onClick={() => moveMsg(idx, -1)} disabled={idx === 0}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Move down"><span><IconButton size="small" onClick={() => moveMsg(idx, 1)} disabled={idx === messages.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteMsg(idx)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            </Box>
          ))}
          {tab === 1 && (
            <>
              <Typography variant="subtitle2">Optional tools</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                <Button size="small" onClick={() => setIncludeTools([...(OPTIONAL_TOOL_NAMES as any)])}>Select all</Button>
                <Button size="small" onClick={() => setIncludeTools([])}>Select none</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {(OPTIONAL_TOOL_NAMES as readonly string[]).map(tool => (
                  <FormControlLabel
                    key={tool}
                    control={<Checkbox size="small" checked={includeTools.includes(tool)} onChange={(_, checked) => setIncludeTools(prev => checked ? [...prev, tool] : prev.filter(t => t !== tool))} />}
                    label={tool}
                  />
                ))}
              </Box>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="subtitle2">Mandatory tools</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                <Button size="small" onClick={() => setIncludeCoreTools([...(CORE_TOOL_NAMES as any)])}>Select all</Button>
                <Button size="small" onClick={() => setIncludeCoreTools([])}>Select none</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {(CORE_TOOL_NAMES as readonly string[]).map(name => (
                  <FormControlLabel key={name} control={<Checkbox size="small" checked={includeCoreTools.includes(name)} onChange={(_, checked) => setIncludeCoreTools(prev => checked ? [...prev, name] : prev.filter(n => n !== name))} />} label={name} />
                ))}
              </Box>
              <FormControl size="small" sx={{ minWidth: 160, mt: 1 }}>
                <InputLabel>Tool choice</InputLabel>
                <Select value={toolChoice} label="Tool choice" onChange={(e) => setToolChoice(e.target.value as any)}>
                  <MenuItem value="auto">auto</MenuItem>
                  <MenuItem value="none">none</MenuItem>
                </Select>
              </FormControl>
            </>
          )}
          {/* Single add control kept below */}
          {error && <Alert severity="error">{error}</Alert>}
          {tab === 2 && lastResponse && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Last response</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(lastResponse?.response?.choices?.[0]?.message || {}, null, 2)}
              </Box>
              {Array.isArray(lastResponse?.response?.choices?.[0]?.message?.tool_calls) && lastResponse.response.choices[0].message.tool_calls.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="subtitle2">Tool calls</Typography>
                  {lastResponse.response.choices[0].message.tool_calls.map((tc: any, i: number) => (
                    <ToolCallEditor key={tc.id || i} toolCall={tc} onAppend={(content) => {
                      setMessages(prev => [...prev, { role: 'tool', content, tool_call_id: tc.id } as any]);
                    }} />
                  ))}
                </Box>
              )}
            </Box>
          )}
          {tab === 3 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Raw last response</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxHeight: 240, overflow: 'auto' }}>
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '(no response)'}
              </Box>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" gutterBottom>Thread (raw)</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxHeight: 240, overflow: 'auto' }}>
                {JSON.stringify(messages, null, 2)}
              </Box>
            </Box>
          )}
          {tab === 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={() => setMessages(prev => [...prev, { role: 'user', content: '' } as any])}>Add message</Button>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={send} disabled={busy || !apiConfigId}>Send</Button>
      </DialogActions>
    </Dialog>
  );
}

function ToolCallEditor({ toolCall, onAppend }: { toolCall: any; onAppend: (content: string) => void }) {
  const [value, setValue] = React.useState<string>(() => {
    try {
      return JSON.stringify({ ok: true, result: null, args: JSON.parse(toolCall.function?.arguments || '{}') }, null, 2);
    } catch {
      return JSON.stringify({ ok: true, result: null }, null, 2);
    }
  });
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, mt: 1 }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{toolCall.function?.name} ({toolCall.id})</Typography>
      <TextField fullWidth multiline minRows={3} value={value} onChange={(e) => setValue(e.target.value)} sx={{ mt: 1 }} />
      <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => onAppend(value)}>Append tool result</Button>
    </Box>
  );
}
