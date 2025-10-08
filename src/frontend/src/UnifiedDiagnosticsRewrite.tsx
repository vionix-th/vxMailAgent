import React, { useState } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Button, Card, CardContent, Tabs, Tab, Grid
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import MessageIcon from '@mui/icons-material/Message';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import ForumIcon from '@mui/icons-material/Forum';
import { useTranslation } from 'react-i18next';
import { EmailEnvelope } from './types/shared';
import EmailProcessingDashboard from './EmailProcessingDashboard';
import ConversationInspector from './ConversationInspector';
import ThreadInspector from './ThreadInspector';
import FetcherControl from './FetcherControl';
import Conversations from './Conversations';
import { useCookieState } from './hooks/useCookieState';

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

export default function UnifiedDiagnosticsRewrite() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useCookieState<number>('vx_ui.diagnostics.tab', 0, { maxAge: 60 * 60 * 24 * 365 });
  const safeTab = tab >= 0 && tab <= 2 ? tab : 0;
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailWithConversations | null>(null);

  const handleEmailSelect = (email: EmailWithConversations) => {
    setSelectedEmail(email);
    setSelectedEmailId(email.id);
    if (email.conversations.length > 0) {
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

  const resetEmailContext = () => {
    setViewMode('dashboard');
    setSelectedEmailId(null);
    setSelectedConversationId(null);
    setSelectedThreadId(null);
    setSelectedEmail(null);
  };

  const handleTabChange = (_: React.SyntheticEvent, value: number) => {
    setTab(value);
    if (value !== 0) {
      resetEmailContext();
    }
  };

  const renderTabPanel = (index: number, children: React.ReactNode) => (
    <Box
      role="tabpanel"
      hidden={safeTab !== index}
      id={`diagnostics-tabpanel-${index}`}
      aria-labelledby={`diagnostics-tab-${index}`}
      sx={{ display: safeTab === index ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}
    >
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {children}
      </Box>
    </Box>
  );

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
        {t('diagnosticsTabs.mailFlow')}
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Paper sx={{ p: 2, borderRadius: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h5" component="h1">
            {t('diagnostics.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('diagnostics.subtitle')}
          </Typography>
        </Stack>
        <Tabs value={safeTab} onChange={handleTabChange} aria-label="diagnostics sections" variant="scrollable" allowScrollButtonsMobile>
          <Tab
            id="diagnostics-tab-0"
            aria-controls="diagnostics-tabpanel-0"
            icon={<EmailIcon fontSize="small" />}
            iconPosition="start"
            label={t('diagnosticsTabs.mailFlow')}
          />
          <Tab
            id="diagnostics-tab-1"
            aria-controls="diagnostics-tabpanel-1"
            icon={<CloudSyncIcon fontSize="small" />}
            iconPosition="start"
            label={t('diagnosticsTabs.fetcher')}
          />
          <Tab
            id="diagnostics-tab-2"
            aria-controls="diagnostics-tabpanel-2"
            icon={<ForumIcon fontSize="small" />}
            iconPosition="start"
            label={t('diagnosticsTabs.conversations')}
          />
        </Tabs>
        {safeTab === 0 && (
          <Box sx={{ mt: 2 }}>
            {renderBreadcrumbs()}
            {(viewMode === 'conversation' || viewMode === 'thread') && renderEmailContext()}
          </Box>
        )}
      </Paper>

      {renderTabPanel(0, (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
      ))}

      {renderTabPanel(1, <FetcherControl />)}

      {renderTabPanel(2, <Conversations />)}
    </Box>
  );
}
