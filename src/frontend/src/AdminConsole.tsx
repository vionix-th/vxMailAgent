import React from 'react';
import { Box, Paper, Tabs, Tab } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Conversations from './Conversations';
import FetcherControl from './FetcherControl';
import Accounts from './Accounts';
import Settings from './Settings';
 import { useCookieState } from './hooks/useCookieState';

export default function AdminConsole() {
  const [tab, setTab] = useCookieState<number>('vx_ui.admin.tab', 0, { maxAge: 60 * 60 * 24 * 365 });
  const { t } = useTranslation();
  // Supported tabs: 0=Fetcher, 1=Conversations, 2=Accounts, 3=Settings
  const safeTab = (tab >= 0 && tab <= 3) ? tab : 0;
  return (
    <Box>
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={safeTab} onChange={(_, v) => setTab(v)}>
          <Tab label={t('adminTabs.fetcher')} />
          <Tab label={t('adminTabs.conversations')} />
          <Tab label={t('adminTabs.accounts')} />
          <Tab label={t('adminTabs.settings')} />
        </Tabs>
      </Paper>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`admin-tab-${safeTab}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
          {safeTab === 0 && <FetcherControl />}
          {safeTab === 1 && <Conversations />}
          {safeTab === 2 && <Accounts showFetcher={false} />}
          {safeTab === 3 && <Settings />}
        </motion.div>
      </AnimatePresence>
    </Box>
  );
}
