import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Stack, IconButton, Chip, Alert,
  Button, Card, CardContent,
  Dialog, DialogTitle, DialogContent, DialogActions, Avatar
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { motion } from 'framer-motion';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BuildIcon from '@mui/icons-material/Build';
import CodeIcon from '@mui/icons-material/Code';
import { ConversationThread, PromptMessage, ProviderEvent } from './types/shared';
import JsonPretty from './components/JsonPretty';
import { apiFetch } from './utils/http';

type ThreadWithContext = ConversationThread & {
  fullMessages: PromptMessage[];
  toolCalls: ToolCallTrace[];
  providerEvents: ProviderEvent[];
};

interface ToolCallTrace {
  id: string;
  name?: string;
  arguments?: string;
  result?: any;
  error?: string;
  timestamp?: string;
  durationMs?: number;
  function?: {
    name: string;
    arguments: string;
  };
}

const getRoleIcon = (role: string) => {
  switch (role) {
    case 'user': return <PersonIcon color="primary" />;
    case 'assistant': return <SmartToyIcon color="secondary" />;
    case 'tool': return <BuildIcon color="action" />;
    case 'system': return <CodeIcon color="disabled" />;
    default: return <PersonIcon />;
  }
};

export default function ThreadInspector({ 
  threadId, 
  onBack 
}: { 
  threadId: string; 
  onBack: () => void; 
}) {
  const [thread, setThread] = useState<ThreadWithContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<PromptMessage | null>(null);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [selectedJson, setSelectedJson] = useState<any>(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'user':
        return theme.palette.primary.main;
      case 'assistant':
        return theme.palette.secondary.main;
      case 'tool':
        return theme.palette.warning.main;
      case 'system':
        return theme.palette.info.main;
      default:
        return theme.palette.text.primary;
    }
  };

  const messageSurface = (role: string) => alpha(getRoleColor(role), isDark ? 0.24 : 0.08);
  const subtleSurface = isDark ? alpha(theme.palette.common.white, 0.06) : theme.palette.grey[50];
  const mutedSurface = isDark ? alpha(theme.palette.common.white, 0.12) : theme.palette.grey[100];
  const threadToolCallLookup = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    thread?.toolCalls?.forEach((tc) => {
      if (tc?.id) {
        map.set(tc.id, tc);
      }
    });
    return map;
  }, [thread]);

  const loadThread = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<ThreadWithContext>(`/api/conversations/threads/${threadId}/full`);
      setThread(response);
    } catch (err: any) {
      setError(err.message || 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThread();
  }, [threadId]);

  const handleViewMessage = (message: PromptMessage) => {
    setSelectedMessage(message);
    setMessageDialogOpen(true);
  };

  const handleViewJson = (data: any) => {
    setSelectedJson(data);
    setJsonDialogOpen(true);
  };

  const renderMessageContent = (content: any) => {
    if (typeof content === 'string') {
      return (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {content}
        </Typography>
      );
    }
    
    if (Array.isArray(content)) {
      return (
        <Stack spacing={1}>
          {content.map((item, index) => (
            <Box key={index}>
              {item.type === 'text' && (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {item.text}
                </Typography>
              )}
              {item.type === 'image_url' && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Image:</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {item.image_url?.url?.substring(0, 100)}...
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      );
    }

    return (
      <Button
        size="small"
        startIcon={<CodeIcon />}
        onClick={() => handleViewJson(content)}
      >
        View Complex Content
      </Button>
    );
  };

  const renderToolCalls = (toolCalls: any[]) => {
    if (!toolCalls || toolCalls.length === 0) return null;

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" gutterBottom>Tool Calls:</Typography>
        <Stack spacing={1}>
          {toolCalls.map((raw, index) => {
            const trace = raw?.id ? threadToolCallLookup.get(raw.id) : undefined;
            const callName = raw?.function?.name || trace?.name || 'tool_call';
            const argumentString = raw?.function?.arguments ?? trace?.arguments ?? '';
            const timestamp = trace?.timestamp ? new Date(trace.timestamp).toLocaleTimeString() : undefined;
            const durationLabel = typeof trace?.durationMs === 'number' ? `${trace.durationMs}ms` : undefined;
            const detailPayload = trace ? { ...trace, function: raw?.function } : raw;

            return (
              <Card key={raw?.id ?? index} variant="outlined" sx={{ backgroundColor: subtleSurface }}>
                <CardContent sx={{ py: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Stack spacing={0.5}>
                      <Typography variant="body2" fontWeight="medium">
                        {callName}
                      </Typography>
                      {(timestamp || durationLabel) && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          {timestamp && <Chip label={timestamp} size="small" variant="outlined" />}
                          {durationLabel && <Chip label={durationLabel} size="small" variant="outlined" />}
                        </Stack>
                      )}
                    </Stack>
                    <Button
                      size="small"
                      startIcon={<CodeIcon />}
                      onClick={() => handleViewJson(detailPayload)}
                    >
                      Details
                    </Button>
                  </Stack>
                  {argumentString && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      {argumentString.substring(0, 100)}
                      {argumentString.length > 100 ? '...' : ''}
                    </Typography>
                  )}
                  {trace?.error && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      <Typography variant="body2">{trace.error}</Typography>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      </Box>
    );
  };

  const renderMessages = () => {
    if (!thread || !thread.fullMessages) return null;

    return (
      <Stack spacing={2}>
        {thread.fullMessages.map((message: PromptMessage, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card 
              variant="outlined" 
              sx={{ 
                borderLeft: `4px solid ${getRoleColor(message.role)}`,
                backgroundColor: messageSurface(message.role)
              }}
            >
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Avatar sx={{ bgcolor: getRoleColor(message.role), width: 32, height: 32 }}>
                      {getRoleIcon(message.role)}
                    </Avatar>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {message.role === 'tool'
                          ? 'Tool response'
                          : message.role.charAt(0).toUpperCase() + message.role.slice(1)}
                      </Typography>
                      {message.name && (
                        <Typography variant="caption" color="text.secondary">
                          {message.name}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    {message.tool_call_id && (
                      <Chip label={`Tool: ${message.tool_call_id}`} size="small" />
                    )}
                    <Button
                      size="small"
                      startIcon={<CodeIcon />}
                      onClick={() => handleViewMessage(message)}
                    >
                      Details
                    </Button>
                  </Stack>
                </Stack>

                <Box sx={{ mb: 2 }}>
                  {renderMessageContent(message.content)}
                </Box>

                {message.tool_calls && renderToolCalls(message.tool_calls)}

                {message.context && (
                  <Box sx={{ mt: 2, p: 1, backgroundColor: mutedSurface, borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Context: {JSON.stringify(message.context, null, 2).substring(0, 200)}...
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </Stack>
    );
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading thread details...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!thread) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Thread not found</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <IconButton onClick={onBack}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">Thread Inspector</Typography>
        <Chip label={thread.id} size="small" />
        <Chip label={thread.kind} color="primary" size="small" />
      </Stack>

      <Stack spacing={3}>
        <Box>
          <Typography variant="h5">Messages ({thread.fullMessages?.length || 0})</Typography>
          {renderMessages()}
        </Box>
      </Stack>

      {/* Message Details Dialog */}
      <Dialog
        open={messageDialogOpen}
        onClose={() => setMessageDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
      <DialogTitle>Message Details</DialogTitle>
      <DialogContent>
        {selectedMessage && <JsonPretty data={selectedMessage} />}
      </DialogContent>
        <DialogActions>
          <Button onClick={() => setMessageDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* JSON Viewer Dialog */}
      <Dialog
        open={jsonDialogOpen}
        onClose={() => setJsonDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
      <DialogTitle>JSON Data</DialogTitle>
      <DialogContent>
        <JsonPretty data={selectedJson} />
      </DialogContent>
        <DialogActions>
          <Button onClick={() => setJsonDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
