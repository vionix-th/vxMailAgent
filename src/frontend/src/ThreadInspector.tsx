import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Stack, IconButton, Tooltip, Chip, Alert, 
  Button, Card, CardContent, Accordion, AccordionSummary, AccordionDetails,
  List, ListItem, ListItemText, ListItemIcon, Divider, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions, Avatar
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BuildIcon from '@mui/icons-material/Build';
import CodeIcon from '@mui/icons-material/Code';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { ConversationThread, PromptMessage, ProviderEvent } from './types/shared';
import { apiFetch } from './utils/http';

interface ThreadWithContext extends ConversationThread {
  fullMessages: PromptMessage[];
  toolCalls: ToolCallTrace[];
  providerEvents: ProviderEvent[];
}

interface ToolCallTrace {
  id: string;
  name: string;
  arguments: string;
  result?: any;
  error?: string;
  timestamp: string;
  durationMs?: number;
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

const getRoleColor = (role: string) => {
  switch (role) {
    case 'user': return '#1976d2';
    case 'assistant': return '#9c27b0';
    case 'tool': return '#ff9800';
    case 'system': return '#757575';
    default: return '#000000';
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

  const loadThread = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/conversations/threads/${threadId}/full`);
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
          {toolCalls.map((tc, index) => (
            <Card key={index} variant="outlined" sx={{ backgroundColor: 'grey.50' }}>
              <CardContent sx={{ py: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight="medium">
                    {tc.function?.name || tc.name}
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<CodeIcon />}
                    onClick={() => handleViewJson(tc)}
                  >
                    View Details
                  </Button>
                </Stack>
                {tc.function?.arguments && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {tc.function.arguments.substring(0, 100)}
                    {tc.function.arguments.length > 100 ? '...' : ''}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Box>
    );
  };

  const renderMessages = () => {
    if (!thread || !thread.fullMessages) return null;

    return (
      <Stack spacing={2}>
        {thread.fullMessages.map((message, index) => (
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
                backgroundColor: message.role === 'user' ? 'primary.50' : 
                                message.role === 'assistant' ? 'secondary.50' : 'grey.50'
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
                        {message.role.charAt(0).toUpperCase() + message.role.slice(1)}
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
                  <Box sx={{ mt: 2, p: 1, backgroundColor: 'grey.100', borderRadius: 1 }}>
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

  const renderToolCallsTrace = () => {
    if (!thread || !thread.toolCalls || thread.toolCalls.length === 0) return null;

    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Tool Execution Trace</Typography>
          <Stack spacing={2}>
            {thread.toolCalls.map((tc, index) => (
              <Accordion key={tc.id}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                    <BuildIcon color="action" />
                    <Typography variant="body1" fontWeight="medium">{tc.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(tc.timestamp).toLocaleTimeString()}
                    </Typography>
                    {tc.durationMs && (
                      <Chip label={`${tc.durationMs}ms`} size="small" />
                    )}
                    {tc.error ? (
                      <ErrorIcon color="error" />
                    ) : (
                      <CheckCircleIcon color="success" />
                    )}
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Arguments:</Typography>
                      <Box
                        component="pre"
                        sx={{
                          backgroundColor: 'grey.100',
                          p: 1,
                          borderRadius: 1,
                          overflow: 'auto',
                          fontSize: '0.75rem',
                        }}
                      >
                        {tc.arguments}
                      </Box>
                    </Box>
                    
                    {tc.result && (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>Result:</Typography>
                        <Box
                          component="pre"
                          sx={{
                            backgroundColor: 'success.50',
                            p: 1,
                            borderRadius: 1,
                            overflow: 'auto',
                            fontSize: '0.75rem',
                          }}
                        >
                          {JSON.stringify(tc.result, null, 2)}
                        </Box>
                      </Box>
                    )}
                    
                    {tc.error && (
                      <Alert severity="error">
                        <Typography variant="body2">{tc.error}</Typography>
                      </Alert>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
        </CardContent>
      </Card>
    );
  };

  const renderProviderEvents = () => {
    if (!thread || !thread.providerEvents || thread.providerEvents.length === 0) return null;

    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Provider Events</Typography>
          <Stack spacing={1}>
            {thread.providerEvents.map((event, index) => (
              <Box key={index} sx={{ p: 2, backgroundColor: 'grey.50', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Chip label={event.type} size="small" />
                    <Typography variant="body2">{event.provider}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    {event.latencyMs && (
                      <Chip label={`${event.latencyMs}ms`} size="small" />
                    )}
                    {event.usage?.totalTokens && (
                      <Chip label={`${event.usage.totalTokens} tokens`} size="small" />
                    )}
                    <Button
                      size="small"
                      startIcon={<CodeIcon />}
                      onClick={() => handleViewJson(event)}
                    >
                      View
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
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

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Stack spacing={3}>
            <Typography variant="h5">Messages ({thread.fullMessages?.length || 0})</Typography>
            {renderMessages()}
          </Stack>
        </Grid>
        
        <Grid item xs={12} lg={4}>
          <Stack spacing={3}>
            {renderToolCallsTrace()}
            {renderProviderEvents()}
          </Stack>
        </Grid>
      </Grid>

      {/* Message Details Dialog */}
      <Dialog
        open={messageDialogOpen}
        onClose={() => setMessageDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Message Details</DialogTitle>
        <DialogContent>
          {selectedMessage && (
            <Box
              component="pre"
              sx={{
                backgroundColor: 'grey.100',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: 400,
                fontSize: '0.875rem',
              }}
            >
              {JSON.stringify(selectedMessage, null, 2)}
            </Box>
          )}
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
          <Box
            component="pre"
            sx={{
              backgroundColor: 'grey.100',
              p: 2,
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 400,
              fontSize: '0.875rem',
            }}
          >
            {JSON.stringify(selectedJson, null, 2)}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJsonDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
