import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Stack, IconButton, Tooltip, Chip, Alert, 
  Button, Card, CardContent, Tab, Tabs, FormControl, InputLabel, 
  Select, MenuItem, TextField, Grid, Divider
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmailIcon from '@mui/icons-material/Email';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import MessageIcon from '@mui/icons-material/Message';
import { EmailEnvelope } from './types/shared';
import EmailProcessingDashboard from './EmailProcessingDashboard';
import ConversationInspector from './ConversationInspector';
import ThreadInspector from './ThreadInspector';

interface EmailWithConversations extends EmailEnvelope {
  conversations: ConversationSummary[];
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  metrics: {
    totalTokens: number;
    totalLatencyMs: number;
    errorCount: number;
  };
}

interface ConversationSummary {
  id: string;
  kind: 'director' | 'agent';
  status: 'ongoing' | 'completed' | 'failed';
  directorId: string;
  agentId?: string;
  messageCount: number;
  tokenUsage: number;
  lastActiveAt: string;
}

type ViewMode = 'dashboard' | 'conversation' | 'thread';

function TabPanel({ children, value, index, ...other }: any) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`diagnostics-tabpanel-${index}`}
      aria-labelledby={`diagnostics-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

export default function UnifiedDiagnosticsRewrite() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailWithConversations | null>(null);

  const handleEmailSelect = (email: EmailWithConversations) => {
    setSelectedEmail(email);
    setSelectedEmailId(email.id);
    
    // If email has conversations, show conversation view
    if (email.conversations.length > 0) {
      // Auto-select first conversation for immediate inspection
      setSelectedConversationId(email.conversations[0].id);
      setViewMode('conversation');
    }
  };

  const handleConversationSelect = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setViewMode('conversation');
  };

  const handleThreadSelect = (threadId: string) => {
    setSelectedThreadId(threadId);
    setViewMode('thread');
  };

  const handleBackToDashboard = () => {
    setViewMode('dashboard');
    setSelectedEmailId(null);
    setSelectedConversationId(null);
    setSelectedThreadId(null);
    setSelectedEmail(null);
  };

  const handleBackToConversation = () => {
    setViewMode('conversation');
    setSelectedThreadId(null);
  };

  const renderBreadcrumbs = () => {
    const breadcrumbs = [];
    
    breadcrumbs.push(
      <Button
        key="dashboard"
        variant={viewMode === 'dashboard' ? 'contained' : 'text'}
        size="small"
        startIcon={<EmailIcon />}
        onClick={handleBackToDashboard}
      >
        Email Dashboard
      </Button>
    );

    if (selectedEmail && (viewMode === 'conversation' || viewMode === 'thread')) {
      breadcrumbs.push(
        <Typography key="separator1" variant="body2" color="text.secondary">
          /
        </Typography>
      );
      breadcrumbs.push(
        <Button
          key="conversation"
          variant={viewMode === 'conversation' ? 'contained' : 'text'}
          size="small"
          startIcon={<AccountTreeIcon />}
          onClick={() => selectedConversationId && handleConversationSelect(selectedConversationId)}
          disabled={!selectedConversationId}
        >
          Conversation
        </Button>
      );
    }

    if (selectedThreadId && viewMode === 'thread') {
      breadcrumbs.push(
        <Typography key="separator2" variant="body2" color="text.secondary">
          /
        </Typography>
      );
      breadcrumbs.push(
        <Button
          key="thread"
          variant="contained"
          size="small"
          startIcon={<MessageIcon />}
        >
          Thread
        </Button>
      );
    }

    return (
      <Stack direction="row" spacing={1} alignItems="center" mb={2}>
        {breadcrumbs}
      </Stack>
    );
  };

  const renderEmailContext = () => {
    if (!selectedEmail) return null;

    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={8}>
              <Typography variant="h6" noWrap>
                {selectedEmail.subject}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                From: {selectedEmail.from} • {new Date(selectedEmail.date).toLocaleString()}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Chip
                  label={selectedEmail.processingStatus}
                  color={
                    selectedEmail.processingStatus === 'completed' ? 'success' :
                    selectedEmail.processingStatus === 'failed' ? 'error' :
                    selectedEmail.processingStatus === 'processing' ? 'info' : 'default'
                  }
                  size="small"
                />
                <Chip
                  label={`${selectedEmail.conversations.length} conversations`}
                  size="small"
                />
                <Chip
                  label={`${selectedEmail.metrics.totalTokens} tokens`}
                  size="small"
                />
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper sx={{ p: 2, borderRadius: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5" component="h1">
            Unified Diagnostics & Conversations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Email-centric LLM agent debugging interface
          </Typography>
        </Stack>
        
        {renderBreadcrumbs()}
        
        {(viewMode === 'conversation' || viewMode === 'thread') && renderEmailContext()}
      </Paper>

      {/* Main Content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'dashboard' && (
          <EmailProcessingDashboard onEmailSelect={handleEmailSelect} />
        )}

        {viewMode === 'conversation' && selectedConversationId && (
          <ConversationInspector
            conversationId={selectedConversationId}
            onBack={handleBackToDashboard}
          />
        )}

        {viewMode === 'thread' && selectedThreadId && (
          <ThreadInspector
            threadId={selectedThreadId}
            onBack={handleBackToConversation}
          />
        )}
      </Box>
    </Box>
  );
}
