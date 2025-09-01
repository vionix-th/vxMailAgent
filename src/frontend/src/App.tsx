import React from 'react';
import { Box, CssBaseline, Toolbar } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { useCookieState } from './hooks/useCookieState';

import Directors from './Directors';
import Results from './Results';
import Filters from './Filters';
import Prompts from './Prompts';
import Memory from './Memory';
import AdminConsole from './AdminConsole';
import NavigationDrawer from './components/NavigationDrawer';
import TopBar from './components/TopBar';

export default function App() {
  const [selected, setSelected] = useCookieState<string>('vx_ui.currentPage', 'Results', { maxAge: 60 * 60 * 24 * 365 });
  const theme = useTheme();

  const bgGradient = React.useMemo(() => {
    const c = theme.palette.mode === 'dark'
      ? 'rgba(122,162,247,0.08)'
      : 'rgba(46,125,233,0.06)';
    return `radial-gradient(640px 640px at 110% -10%, ${c} 0%, rgba(0,0,0,0) 60%)`;
  }, [theme.palette.mode]);

  const view = React.useMemo(() => {
    switch (selected) {
      case 'Results': return <Results />;
      case 'Memory': return <Memory />;
      case 'Filters': return <Filters />;
      case 'Directors': return <Directors />;
      case 'Prompts': return <Prompts />;
      case 'Admin': return <AdminConsole />;
      default: return <Results />;
    }
  }, [selected]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      <CssBaseline />
      <TopBar />
      <NavigationDrawer selected={selected} onSelect={setSelected} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflowX: 'hidden',
          backgroundImage: bgGradient,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'auto',
          backgroundAttachment: 'scroll',
        }}
        className="px-4 py-3 overflow-auto min-w-0"
      >
        <Toolbar variant="dense" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selected}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {view}
          </motion.div>
        </AnimatePresence>
      </Box>
    </Box>
  );
}

