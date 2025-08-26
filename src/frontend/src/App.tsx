import React from 'react';
import { Box, CssBaseline, Drawer, List, ListItemButton, ListItemText, Toolbar, AppBar, Typography, ListItemIcon, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import MemoryIcon from '@mui/icons-material/Memory';
import SummarizeIcon from '@mui/icons-material/Summarize';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import TranslateIcon from '@mui/icons-material/Translate';
import LogoutIcon from '@mui/icons-material/Logout';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { useSettings } from './SettingsContext';
import { logout } from './authClient';

import { AnimatePresence, motion } from 'framer-motion';
import { useCookieState } from './hooks/useCookieState';

const drawerWidth = 240;
const collapsedWidth = 64;

import Directors from './Directors';
import Results from './Results';
import Filters from './Filters';
import Prompts from './Prompts';
import Memory from './Memory';
import AdminConsole from './AdminConsole';


export default function App() {
  const { t } = useTranslation();
  const { themePreference, setThemePreference, language, setLanguage } = useSettings();
  const [themeMenuAnchor, setThemeMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [langMenuAnchor, setLangMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [navCollapsed, setNavCollapsed] = useCookieState<boolean>('vx_ui.navCollapsed', true, { maxAge: 60 * 60 * 24 * 365 });
  const themeIcon = themePreference === 'light' ? <LightModeIcon fontSize="small" /> : themePreference === 'dark' ? <DarkModeIcon fontSize="small" /> : <SettingsBrightnessIcon fontSize="small" />;
  const theme = useTheme();

  // Ultra-discreet single shape: off-canvas radial to keep it subtle
  const bgGradient = React.useMemo(() => {
    const c = theme.palette.mode === 'dark'
      ? 'rgba(122,162,247,0.08)'
      : 'rgba(46,125,233,0.06)';
    return `radial-gradient(640px 640px at 110% -10%, ${c} 0%, rgba(0,0,0,0) 60%)`;
  }, [theme.palette.mode]);

  

  const navItems: { key: string; label: string; icon: React.ReactElement }[] = [
    { key: 'Results', label: t('nav.results'), icon: <SummarizeIcon fontSize="small" /> },
    { key: 'Memory', label: t('nav.memory'), icon: <MemoryIcon fontSize="small" /> },
    { key: 'Prompts', label: t('nav.prompts'), icon: <ChatBubbleOutlineIcon fontSize="small" /> },    
    { key: 'Directors', label: t('nav.directors'), icon: <AccountTreeIcon fontSize="small" /> },
    { key: 'Filters', label: t('nav.filters'), icon: <FilterAltIcon fontSize="small" /> },
    { key: 'Admin', label: t('nav.admin'), icon: <TroubleshootIcon fontSize="small" /> },
  ];

  const [selected, setSelected] = useCookieState<string>('vx_ui.currentPage', 'Results', { maxAge: 60 * 60 * 24 * 365 });
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
      <AppBar position="fixed" color="default" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, borderRadius: 0, overflow: 'visible' }}>
        <Toolbar variant="dense">
          <Typography variant="h6" noWrap component="div">{t('appTitle')}</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title={t(`theme.${themePreference}`) as string}>
              <IconButton size="small" onClick={(e) => setThemeMenuAnchor(e.currentTarget)}>
                {themeIcon}
              </IconButton>
            </Tooltip>
            <Menu anchorEl={themeMenuAnchor} open={Boolean(themeMenuAnchor)} onClose={() => setThemeMenuAnchor(null)}>
              <MenuItem onClick={() => { setThemePreference('light'); setThemeMenuAnchor(null); }}>
                <LightModeIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.light')}
              </MenuItem>
              <MenuItem onClick={() => { setThemePreference('dark'); setThemeMenuAnchor(null); }}>
                <DarkModeIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.dark')}
              </MenuItem>
              <MenuItem onClick={() => { setThemePreference('system'); setThemeMenuAnchor(null); }}>
                <SettingsBrightnessIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.system')}
              </MenuItem>
            </Menu>

            <Tooltip title={t('lang.' + language) as string}>
              <IconButton size="small" onClick={(e) => setLangMenuAnchor(e.currentTarget)}>
                <TranslateIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={langMenuAnchor} open={Boolean(langMenuAnchor)} onClose={() => setLangMenuAnchor(null)}>
              <MenuItem onClick={() => { setLanguage('en'); setLangMenuAnchor(null); }}>
                <span style={{ marginRight: 8 }}>🇬🇧</span> {t('lang.en')}
              </MenuItem>
              <MenuItem onClick={() => { setLanguage('th'); setLangMenuAnchor(null); }}>
                <span style={{ marginRight: 8 }}>🇹🇭</span> {t('lang.th')}
              </MenuItem>
            </Menu>

            <Tooltip title={t('actions.logout') as string}>
              <IconButton
                size="small"
                onClick={async () => {
                  try { await logout(); } finally { window.location.href = '/login'; }
                }}
                aria-label={t('actions.logout') as string}
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: navCollapsed ? collapsedWidth : drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: (theme) => ({
            width: navCollapsed ? collapsedWidth : drawerWidth,
            transition: theme.transitions.create('width', {
              duration: theme.transitions.duration.shorter,
              easing: theme.transitions.easing.sharp,
            }),
            boxSizing: 'border-box',
            overflow: 'hidden',
            willChange: 'width',
            borderRadius: 0,
            border: 'none',
            borderRight: `1px solid ${theme.palette.divider}`,
          }),
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Toolbar variant="dense" />
          <List dense sx={{ flexGrow: 1 }}>
            {navItems.map((item) => (
              <ListItemButton
                key={item.key}
                selected={selected === item.key}
                onClick={() => setSelected(item.key)}
                sx={{
                  ...(navCollapsed && { justifyContent: 'center' }),
                  py: 0.75,
                  '&.Mui-selected': {
                    backgroundColor: 'action.selected',
                  },
                  '&.Mui-selected:hover': {
                    backgroundColor: 'action.selected',
                  },
                }}
              >
                <Tooltip
                  title={item.label as string}
                  placement="right"
                  disableHoverListener={!navCollapsed}
                  disableFocusListener
                  disableTouchListener
                  describeChild
                  enterDelay={200}
                  leaveDelay={0}
                  disableInteractive
                  arrow
                  PopperProps={{
                    disablePortal: false,
                    modifiers: [
                      { name: 'offset', options: { offset: [0, 8] } },
                    ],
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: navCollapsed ? 'auto' : 36,
                      mr: navCollapsed ? 0 : 1,
                      color: selected === item.key ? 'primary.main' : 'text.secondary',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                </Tooltip>
                <ListItemText
                  primary={item.label}
                  sx={{
                    opacity: navCollapsed ? 0 : 1,
                    transition: (theme) => theme.transitions.create('opacity', { duration: theme.transitions.duration.shortest }),
                    whiteSpace: 'nowrap',
                    width: navCollapsed ? 0 : 'auto',
                    overflow: 'hidden',
                  }}
                />
              </ListItemButton>
            ))}
          </List>
          <List dense sx={{ pt: 0, pb: 0 }}>
            <ListItemButton
              onClick={() => setNavCollapsed((v) => !v)}
              aria-label={t(navCollapsed ? 'sidebar.expand' : 'sidebar.collapse') as string}
              sx={{
                ...(navCollapsed && { justifyContent: 'center' }),
                py: 0.75,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: navCollapsed ? 'auto' : 36,
                  mr: navCollapsed ? 0 : 1,
                  justifyContent: 'center',
                }}
              >
                {navCollapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={t(navCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
                sx={{
                  opacity: navCollapsed ? 0 : 1,
                  transition: (theme) => theme.transitions.create('opacity', { duration: theme.transitions.duration.shortest }),
                  whiteSpace: 'nowrap',
                  width: navCollapsed ? 0 : 'auto',
                  overflow: 'hidden',
                }}
              />
            </ListItemButton>
          </List>
        </Box>
      </Drawer>
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
