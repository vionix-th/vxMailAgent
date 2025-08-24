import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, IconButton, Tooltip, Chip, Alert, Divider,
  TreeView, TreeItem, Accordion, AccordionSummary, AccordionDetails, Tabs, Tab,
  Button, Card, CardContent
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import EmailIcon from '@mui/icons-material/Email';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ChatIcon from '@mui/icons-material/Chat';
import ApiIcon from '@mui/icons-material/Api';
import { useTranslation } from 'react-i18next';
import { getUnifiedDiagnostics, getUnifiedDiagnosticsNode, DiagnosticNode, UnifiedDiagnosticsResponse } from './utils/api';

const getNodeIcon = (type: string, status?: string) => {
  const color = status === 'error' ? 'error' : status === 'success' ? 'success' : 'default';
  
  switch (type) {
    case 'fetchCycle': return <AccountTreeIcon color={color} />;
    case 'account': return <PersonIcon color={color} />;
    case 'email': return <EmailIcon color={color} />;
    case 'director': return <PersonIcon color={color} />;
    case 'agent': return <SmartToyIcon color={color} />;
    case 'conversation': return <ChatIcon color={color} />;
    case 'providerEvent': return <ApiIcon color={color} />;
    default: return <ChevronRightIcon color={color} />;
  }
};

const getStatusChip = (status?: string) => {
  if (!status) return null;
  
  switch (status) {
    case 'error':
      return <Chip size="small" color="error" icon={<ErrorIcon />} label="Error" />;
    case 'success':
      return <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Success" />;
    default:
      return <Chip size="small" label={status} />;
  }
};

interface TreeNodeProps {
  node: DiagnosticNode;
  onNodeSelect: (node: DiagnosticNode) => void;
  selectedNodeId?: string;
  level: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, onNodeSelect, selectedNodeId, level }) => {
  const [expanded, setExpanded] = useState(level < 3); // Auto-expand first 3 levels to show agents
  const isSelected = selectedNodeId === node.id;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <Box>
      <Paper 
        variant="outlined" 
        sx={{ 
          p: 1, 
          mb: 0.5, 
          cursor: 'pointer',
          borderColor: isSelected ? 'primary.main' : 'divider',
          bgcolor: isSelected ? 'action.selected' : 'background.paper'
        }}
        onClick={() => onNodeSelect(node)}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {hasChildren && (
            <IconButton 
              size="small" 
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            >
              {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
            </IconButton>
          )}
          {!hasChildren && <Box sx={{ width: 32 }} />}
          
          {getNodeIcon(node.type, node.status)}
          
          <Typography variant="body2" sx={{ flex: 1, fontWeight: level < 2 ? 'bold' : 'normal' }}>
            {node.name}
          </Typography>
          
          {getStatusChip(node.status)}
          
          {node.metadata?.totalDirectorConversations && node.metadata.totalDirectorConversations > 0 && (
            <Chip size="small" color="secondary" label={`${node.metadata.totalDirectorConversations} directors`} />
          )}
          
          {node.metadata?.totalAgentConversations && node.metadata.totalAgentConversations > 0 && (
            <Chip size="small" color="secondary" label={`${node.metadata.totalAgentConversations} agents`} />
          )}
          
          {node.metadata?.totalProviderEvents && node.metadata.totalProviderEvents > 0 && (
            <Chip size="small" color="primary" label={`${node.metadata.totalProviderEvents} LLM calls`} />
          )}

          {node.metadata?.messageCount && node.metadata.messageCount > 0 && (
            <Chip size="small" label={`${node.metadata.messageCount} messages`} />
          )}
          
          {node.timestamp && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {new Date(node.timestamp).toLocaleTimeString()}
            </Typography>
          )}
        </Stack>
      </Paper>
      
      {expanded && hasChildren && (
        <Box sx={{ mt: 0.5, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              onNodeSelect={onNodeSelect}
              selectedNodeId={selectedNodeId}
              level={level + 1}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

const NodeDetailView: React.FC<{ node: DiagnosticNode | null }> = ({ node }) => {
  const { t } = useTranslation();
  const [detailTab, setDetailTab] = useState(0);
  const [nodeDetail, setNodeDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) {
      setNodeDetail(null);
      return;
    }

    // For conversations and provider events, fetch detailed data
    if (node.type === 'conversation' || node.type === 'providerEvent') {
      setLoading(true);
      getUnifiedDiagnosticsNode(node.id)
        .then(setNodeDetail)
        .catch(() => setNodeDetail(null))
        .finally(() => setLoading(false));
    } else {
      setNodeDetail(null);
    }
  }, [node]);

  if (!node) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        Select a node to view details
      </Typography>
    );
  }

  const renderConversationDetail = () => {
    const conversation = nodeDetail || node.conversation;
    if (!conversation) return null;

    return (
      <Box>
        <Typography variant="h6" gutterBottom>Conversation Details</Typography>
        <Stack spacing={2}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2">Metadata</Typography>
              <Typography variant="body2">ID: {conversation.id}</Typography>
              <Typography variant="body2">Kind: {conversation.kind}</Typography>
              <Typography variant="body2">Created: {conversation.createdAt}</Typography>
              <Typography variant="body2">Messages: {conversation.messages?.length || 0}</Typography>
              <Typography variant="body2">Status: {conversation.finalized ? 'Finalized' : 'Active'}</Typography>
            </CardContent>
          </Card>

          {conversation.messages && conversation.messages.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" gutterBottom>Messages</Typography>
                <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                  {conversation.messages.map((msg: any, idx: number) => (
                    <Box key={idx} sx={{ mb: 2, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Chip size="small" label={msg.role} color={msg.role === 'user' ? 'primary' : msg.role === 'assistant' ? 'secondary' : 'default'} />
                        {msg.tool_calls && <Chip size="small" label={`${msg.tool_calls.length} tool calls`} color="warning" />}
                      </Stack>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content || '[No content]'}
                      </Typography>
                      {msg.tool_calls && (
                        <Box sx={{ mt: 1, p: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'action.hover', borderRadius: 1 }}>
                          <Typography variant="caption" color="text.secondary">Tool Calls:</Typography>
                          <Box component="pre" sx={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(msg.tool_calls, null, 2)}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Box>
    );
  };

  const renderProviderEventDetail = () => {
    const event = nodeDetail || node.providerEvent;
    if (!event) return null;

    return (
      <Box>
        <Typography variant="h5" gutterBottom color="primary">
          🤖 LLM {event.type.toUpperCase()}: {event.provider}
        </Typography>
        
        <Stack spacing={3}>
          <Card variant="outlined" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : 'primary.50' }}>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>Event Metadata</Typography>
              <Stack spacing={1}>
                <Typography variant="body1"><strong>Provider:</strong> {event.provider}</Typography>
                <Typography variant="body1"><strong>Type:</strong> {event.type}</Typography>
                <Typography variant="body1"><strong>Timestamp:</strong> {event.timestamp}</Typography>
                {event.latencyMs && <Typography variant="body1"><strong>Latency:</strong> {event.latencyMs}ms</Typography>}
                {event.usage && (
                  <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'success.dark' : 'success.50', borderRadius: 1 }}>
                    <Typography variant="h6" color="success.main" gutterBottom>Token Usage</Typography>
                    <Typography variant="body1">Prompt Tokens: <strong>{event.usage.promptTokens}</strong></Typography>
                    <Typography variant="body1">Completion Tokens: <strong>{event.usage.completionTokens}</strong></Typography>
                    <Typography variant="body1">Total Tokens: <strong>{event.usage.totalTokens}</strong></Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          {event.payload && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ color: event.type === 'request' ? 'warning.main' : 'info.main' }}>
                  📤 {event.type === 'request' ? 'Full Request Payload' : '📥 Full Response Payload'}
                </Typography>
                <Box 
                  component="pre" 
                  sx={{ 
                    whiteSpace: 'pre-wrap', 
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100', 
                    color: (theme) => theme.palette.mode === 'dark' ? 'grey.100' : 'grey.900',
                    p: 2, 
                    borderRadius: 1,
                    fontSize: '0.8rem',
                    fontFamily: 'Monaco, Consolas, monospace',
                    border: '1px solid',
                    borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.300',
                    maxHeight: 'none', // Remove height restriction
                    overflow: 'auto',
                    lineHeight: 1.4
                  }}
                >
                  {JSON.stringify(event.payload, null, 2)}
                </Box>
              </CardContent>
            </Card>
          )}

          {event.error && (
            <Alert severity="error" sx={{ fontSize: '1rem' }}>
              <Typography variant="h6" gutterBottom>❌ Error Details</Typography>
              <Typography variant="body1">{event.error}</Typography>
            </Alert>
          )}
        </Stack>
      </Box>
    );
  };

  const renderGenericDetail = () => (
    <Box>
      <Typography variant="h6" gutterBottom>{node.name}</Typography>
      <Stack spacing={2}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2">Node Information</Typography>
            <Typography variant="body2">Type: {node.type}</Typography>
            <Typography variant="body2">ID: {node.id}</Typography>
            {node.timestamp && <Typography variant="body2">Timestamp: {node.timestamp}</Typography>}
            {node.status && <Typography variant="body2">Status: {node.status}</Typography>}
          </CardContent>
        </Card>

        {node.metadata && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>Metadata</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                {JSON.stringify(node.metadata, null, 2)}
              </Box>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ p: 2 }}>
      {loading && <Typography color="text.secondary">Loading details...</Typography>}
      
      {!loading && (
        <>
          {node.type === 'conversation' && renderConversationDetail()}
          {node.type === 'providerEvent' && renderProviderEventDetail()}
          {node.type !== 'conversation' && node.type !== 'providerEvent' && renderGenericDetail()}
        </>
      )}
    </Box>
  );
};

export default function UnifiedDiagnostics() {
  const { t } = useTranslation();
  const [data, setData] = useState<UnifiedDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<DiagnosticNode | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getUnifiedDiagnostics();
      setData(response);
      // Auto-select first node if none selected
      if (!selectedNode && response.tree.length > 0) {
        setSelectedNode(response.tree[0]);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5">Unified Diagnostics</Typography>
        <Tooltip title="Refresh">
          <IconButton onClick={fetchData} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {data?.summary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>System Overview</Typography>
          <Stack direction="row" spacing={3} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">Fetch Cycles</Typography>
              <Typography variant="h6">{data.summary.totalFetchCycles}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Emails</Typography>
              <Typography variant="h6">{data.summary.totalEmails}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Directors</Typography>
              <Typography variant="h6">{data.summary.totalDirectors}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Agents</Typography>
              <Typography variant="h6">{data.summary.totalAgents}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Conversations</Typography>
              <Typography variant="h6">{data.summary.totalConversations}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">LLM Events</Typography>
              <Typography variant="h6">{data.summary.totalProviderEvents}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Errors</Typography>
              <Typography variant="h6" color={data.summary.totalErrors > 0 ? 'error.main' : 'text.primary'}>
                {data.summary.totalErrors}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 2, height: '80vh' }}>
        {/* Left: Hierarchical Tree */}
        <Box 
          sx={{ 
            width: '45%',
            minWidth: '400px',
            maxWidth: '60%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Paper 
            variant="outlined" 
            sx={{ 
              p: 2, 
              overflow: 'auto',
              flex: 1
            }}
          >
            {loading && <Typography color="text.secondary">Loading...</Typography>}
            
            {data?.tree && data.tree.length > 0 ? (
              <Box>
                {data.tree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    onNodeSelect={setSelectedNode}
                    selectedNodeId={selectedNode?.id}
                    level={0}
                  />
                ))}
              </Box>
            ) : (
              !loading && <Typography color="text.secondary">No diagnostic data available</Typography>
            )}
          </Paper>
        </Box>

        {/* Right: Detail View */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 1 }}>
            <NodeDetailView node={selectedNode} />
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
