import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, IconButton, Tooltip, Chip, Alert, 
  Button, Card, CardContent, Accordion, AccordionSummary, AccordionDetails,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Divider, Grid, List, ListItem, ListItemText, ListItemIcon,
  Dialog, DialogTitle, DialogContent, DialogActions, Tab, Tabs
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import MessageIcon from '@mui/icons-material/Message';
import BuildIcon from '@mui/icons-material/Build';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TokenIcon from '@mui/icons-material/Token';
import CodeIcon from '@mui/icons-material/Code';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { ConversationThread, OrchestrationEvent, ProviderEvent, WorkspaceItem } from './types/shared';
import JsonPretty from './components/JsonPretty';
import { apiFetch } from './utils/http';

interface ConversationDetails extends ConversationThread {
  providerEvents: ProviderEvent[];
  orchestrationEvents: OrchestrationEvent[];
  workspaceItems: WorkspaceItem[];
  metrics: ConversationMetrics;
}

interface ConversationMetrics {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalLatencyMs: number;
  requestCount: number;
  errorCount: number;
  toolCallCount: number;
}

interface ThreadWithContext extends ConversationThread {
  fullMessages: any[];
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

function TabPanel({ children, value, index, ...other }: any) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`conversation-tabpanel-${index}`}
      aria-labelledby={`conversation-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function ConversationInspector({ 
  conversationId, 
  onBack 
}: { 
  conversationId: string; 
  onBack: () => void; 
}) {
  const [conversation, setConversation] = useState<ConversationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [threadDetails, setThreadDetails] = useState<ThreadWithContext | null>(null);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [selectedJson, setSelectedJson] = useState<any>(null);

  const loadConversation = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/conversations/${conversationId}/details`);
      setConversation(response);
    } catch (err: any) {
      setError(err.message || 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const loadThreadDetails = async (threadId: string) => {
    try {
      const response = await apiFetch(`/api/conversations/threads/${threadId}/full`);
      setThreadDetails(response);
      setSelectedThread(threadId);
    } catch (err: any) {
      setError(err.message || 'Failed to load thread details');
    }
  };

  useEffect(() => {
    loadConversation();
  }, [conversationId]);

  const handleViewJson = (data: any) => {
    setSelectedJson(data);
    setJsonDialogOpen(true);
  };

  const renderMetricsCard = () => {
    if (!conversation) return null;

    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Performance Metrics</Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <Stack alignItems="center">
                <TokenIcon color="primary" />
                <Typography variant="h6">{conversation.metrics.totalTokens.toLocaleString()}</Typography>
                <Typography variant="caption">Total Tokens</Typography>
              </Stack>
            </Grid>
            <Grid item xs={6} md={3}>
              <Stack alignItems="center">
                <AccessTimeIcon color="primary" />
                <Typography variant="h6">{Math.round(conversation.metrics.totalLatencyMs)}ms</Typography>
                <Typography variant="caption">Total Latency</Typography>
              </Stack>
            </Grid>
            <Grid item xs={6} md={3}>
              <Stack alignItems="center">
                <MessageIcon color="primary" />
                <Typography variant="h6">{conversation.metrics.requestCount}</Typography>
                <Typography variant="caption">API Requests</Typography>
              </Stack>
            </Grid>
            <Grid item xs={6} md={3}>
              <Stack alignItems="center">
                <BuildIcon color="primary" />
                <Typography variant="h6">{conversation.metrics.toolCallCount}</Typography>
                <Typography variant="caption">Tool Calls</Typography>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  const renderConversationOverview = () => {
    if (!conversation) return null;

    return (
      <Stack spacing={3}>
        {renderMetricsCard()}
        
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Conversation Details</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Type</Typography>
                <Chip label={conversation.kind} color="primary" size="small" />
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Chip 
                  label={conversation.status} 
                  color={conversation.status === 'completed' ? 'success' : conversation.status === 'failed' ? 'error' : 'info'} 
                  size="small" 
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Director ID</Typography>
                <Typography variant="body1">{conversation.directorId}</Typography>
              </Grid>
              {conversation.kind === 'agent' && (
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">Agent ID</Typography>
                  <Typography variant="body1">{conversation.agentId}</Typography>
                </Grid>
              )}
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Last Active</Typography>
                <Typography variant="body1">{new Date(conversation.lastActiveAt).toLocaleString()}</Typography>
              </Grid>
              {conversation.endedAt && (
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">Ended At</Typography>
                  <Typography variant="body1">{new Date(conversation.endedAt).toLocaleString()}</Typography>
                </Grid>
              )}
            </Grid>
          </CardContent>
        </Card>

        {conversation.messages.length > 0 && (
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">Messages ({conversation.messages.length})</Typography>
                <Button
                  size="small"
                  startIcon={<VisibilityIcon />}
                  onClick={() => loadThreadDetails(conversation.id)}
                >
                  View Full Thread
                </Button>
              </Stack>
              <List>
                {conversation.messages.slice(0, 5).map((message, index) => (
                  <ListItem key={index} divider>
                    <ListItemIcon>
                      <MessageIcon color={message.role === 'user' ? 'primary' : 'secondary'} />
                    </ListItemIcon>
                    <ListItemText
                      primary={`${message.role} message`}
                      secondary={
                        <Typography variant="body2" noWrap>
                          {typeof message.content === 'string' 
                            ? message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '')
                            : 'Complex content'
                          }
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
                {conversation.messages.length > 5 && (
                  <ListItem>
                    <ListItemText
                      primary={`... and ${conversation.messages.length - 5} more messages`}
                      sx={{ textAlign: 'center', fontStyle: 'italic' }}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>
        )}
      </Stack>
    );
  };

  const renderProviderEvents = () => {
    if (!conversation) return null;

    return (
      <Stack spacing={2}>
        {conversation.providerEvents.map((event, index) => (
          <Accordion key={index}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                <Chip label={event.type} size="small" />
                <Typography variant="body2">{event.provider}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </Typography>
                {event.latencyMs && (
                  <Typography variant="caption" color="text.secondary">
                    {event.latencyMs}ms
                  </Typography>
                )}
                {event.usage && (
                  <Typography variant="caption" color="text.secondary">
                    {event.usage.totalTokens} tokens
                  </Typography>
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                {event.type !== 'error' && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>{event.type === 'request' ? 'Request Payload' : 'Response Payload'}</Typography>
                    <JsonPretty data={event.payload} filename={`provider-${event.id}.json`} maxHeight={320} />
                  </Box>
                )}
                {event.error && (
                  <Alert severity="error">
                    <Typography variant="body2">{event.error}</Typography>
                  </Alert>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>
    );
  };

  const renderOrchestrationEvents = () => {
    if (!conversation) return null;

    return (
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Timestamp</TableCell>
              <TableCell>Event</TableCell>
              <TableCell>Success</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {conversation.orchestrationEvents.map((event, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Typography variant="body2">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{event.context.event}</Typography>
                </TableCell>
                <TableCell>
                  {event.outcome.success ? (
                    <CheckCircleIcon color="success" />
                  ) : (
                    <ErrorIcon color="error" />
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    startIcon={<CodeIcon />}
                    onClick={() => handleViewJson(event)}
                  >
                    View Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  const renderWorkspaceItems = () => {
    if (!conversation) return null;

    return (
      <Stack spacing={2}>
        {conversation.workspaceItems.map((item) => (
          <Card key={item.id}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">{item.metadata.label || 'Untitled'}</Typography>
                <Chip label={item.content.mimeType} size="small" />
              </Stack>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {item.metadata.description}
              </Typography>
              <Stack direction="row" spacing={1} mb={2}>
                {item.metadata.tags.map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" />
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Created by {item.provenance.createdBy} • {new Date(item.lifecycle.created).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>Loading conversation details...</Typography>
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

  if (!conversation) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Conversation not found</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <IconButton onClick={onBack}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">Conversation Inspector</Typography>
        <Chip label={conversation.id} size="small" />
      </Stack>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedTab} onChange={(_, newValue) => setSelectedTab(newValue)}>
          <Tab label="Overview" />
          <Tab label="Provider Events" />
          <Tab label="Orchestration" />
          <Tab label="Workspace Items" />
        </Tabs>
      </Box>

      <TabPanel value={selectedTab} index={0}>
        {renderConversationOverview()}
      </TabPanel>

      <TabPanel value={selectedTab} index={1}>
        {renderProviderEvents()}
      </TabPanel>

      <TabPanel value={selectedTab} index={2}>
        {renderOrchestrationEvents()}
      </TabPanel>

      <TabPanel value={selectedTab} index={3}>
        {renderWorkspaceItems()}
      </TabPanel>

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
