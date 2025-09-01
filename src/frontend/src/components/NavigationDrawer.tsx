import React from 'react';
import { Drawer, List, ListItemButton, ListItemText, ListItemIcon, Toolbar, Box, Tooltip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SummarizeIcon from '@mui/icons-material/Summarize';
import MemoryIcon from '@mui/icons-material/Memory';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import { useTranslation } from 'react-i18next';
import { useCookieState } from '../hooks/useCookieState';

const drawerWidth = 240;
const collapsedWidth = 64;

interface Props {
  selected: string;
  onSelect: (key: string) => void;
}

const NavigationDrawer: React.FC<Props> = ({ selected, onSelect }) => {
  const { t } = useTranslation();
  const [navCollapsed, setNavCollapsed] = useCookieState<boolean>('vx_ui.navCollapsed', true, { maxAge: 60 * 60 * 24 * 365 });

  const navItems: { key: string; label: string; icon: React.ReactElement }[] = [
    { key: 'Results', label: t('nav.results'), icon: <SummarizeIcon fontSize="small" /> },
    { key: 'Memory', label: t('nav.memory'), icon: <MemoryIcon fontSize="small" /> },
    { key: 'Prompts', label: t('nav.prompts'), icon: <ChatBubbleOutlineIcon fontSize="small" /> },
    { key: 'Directors', label: t('nav.directors'), icon: <AccountTreeIcon fontSize="small" /> },
    { key: 'Filters', label: t('nav.filters'), icon: <FilterAltIcon fontSize="small" /> },
    { key: 'Admin', label: t('nav.admin'), icon: <TroubleshootIcon fontSize="small" /> },
  ];

  return (
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
              onClick={() => onSelect(item.key)}
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
  );
};

export default NavigationDrawer;

