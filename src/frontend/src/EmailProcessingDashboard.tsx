import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, IconButton, Tooltip, Chip, Alert, 
  Button, Card, CardContent, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, LinearProgress, FormControl, InputLabel, Select, 
  MenuItem, TextField, Divider
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmailIcon from '@mui/icons-material/Email';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useTranslation } from 'react-i18next';
import { EmailEnvelope } from './types/shared';
import { apiFetch } from './utils/http';

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

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed': return <CheckCircleIcon color="success" />;
    case 'failed': return <ErrorIcon color="error" />;
    case 'processing': return <PlayArrowIcon color="info" />;
    case 'pending': return <HourglassEmptyIcon color="disabled" />;
    default: return <HourglassEmptyIcon />;
  }
};

const getStatusColor = (status: string): 'success' | 'error' | 'info' | 'default' => {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'error';
    case 'processing': return 'info';
    default: return 'default';
  }
};

export default function EmailProcessingDashboard({ onEmailSelect }: { onEmailSelect: (email: EmailWithConversations) => void }) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<EmailWithConversations[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const loadEmails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/emails', {
        method: 'GET',
        params: {
          limit: 50,
          offset: 0,
          status: statusFilter === 'all' ? undefined : statusFilter,
        },
      });
      setEmails(response.emails || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmails();
  }, [statusFilter]);

  const filteredEmails = useMemo(() => {
    if (!searchTerm) return emails;
    const term = searchTerm.toLowerCase();
    return emails.filter(email => 
      email.subject.toLowerCase().includes(term) ||
      email.from.toLowerCase().includes(term) ||
      email.to.toLowerCase().includes(term)
    );
  }, [emails, searchTerm]);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    emails.forEach(email => {
      counts[email.processingStatus]++;
    });
    return counts;
  }, [emails]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Email Processing Dashboard
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadEmails}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      {/* Status Overview Cards */}
      <Stack direction="row" spacing={2} mb={3}>
        {Object.entries(statusCounts).map(([status, count]) => (
          <Card key={status} sx={{ minWidth: 120 }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Stack alignItems="center" spacing={1}>
                {getStatusIcon(status)}
                <Typography variant="h6">{count}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* Filters */}
      <Stack direction="row" spacing={2} mb={3}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="processing">Processing</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
            <MenuItem value="failed">Failed</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Search emails"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ minWidth: 300 }}
        />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Email List */}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>From</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Conversations</TableCell>
                <TableCell>Tokens</TableCell>
                <TableCell>Errors</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <AnimatePresence>
                {filteredEmails.map((email) => (
                  <motion.tr
                    key={email.id}
                    component={TableRow}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.2 }}
                    hover
                  >
                    <TableCell>
                      <Chip
                        icon={getStatusIcon(email.processingStatus)}
                        label={email.processingStatus}
                        color={getStatusColor(email.processingStatus)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {email.subject}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {email.from}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(email.date).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {email.conversations.map((conv) => (
                          <Chip
                            key={conv.id}
                            label={`${conv.kind}${conv.kind === 'agent' ? ` (${conv.messageCount})` : ''}`}
                            color={getStatusColor(conv.status)}
                            size="small"
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {email.metrics.totalTokens.toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {email.metrics.errorCount > 0 && (
                        <Chip
                          icon={<ErrorIcon />}
                          label={email.metrics.errorCount}
                          color="error"
                          size="small"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => onEmailSelect(email)}
                        disabled={email.conversations.length === 0}
                      >
                        <VisibilityIcon />
                      </IconButton>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {filteredEmails.length === 0 && !loading && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <EmailIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No emails found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm ? 'Try adjusting your search criteria' : 'No emails match the current filters'}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
