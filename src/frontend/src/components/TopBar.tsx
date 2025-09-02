import React from 'react';
import { AppBar, Toolbar, Typography, Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import TranslateIcon from '@mui/icons-material/Translate';
import LogoutIcon from '@mui/icons-material/Logout';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../SettingsContext';
import { logout } from '../authClient';

const TopBar: React.FC = () => {
  const { t } = useTranslation();
  const { themePreference, setThemePreference, language, setLanguage } = useSettings();
  const [themeAnchor, setThemeAnchor] = React.useState<null | HTMLElement>(null);
  const [langAnchor, setLangAnchor] = React.useState<null | HTMLElement>(null);

  const themeIcon =
    themePreference === 'light' ? (
      <LightModeIcon fontSize="small" />
    ) : themePreference === 'dark' ? (
      <DarkModeIcon fontSize="small" />
    ) : (
      <SettingsBrightnessIcon fontSize="small" />
    );

  return (
    <AppBar position="fixed" color="inherit" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, borderRadius: 0, overflow: 'visible' }}>
      <Toolbar variant="dense">
        <Typography variant="h6" noWrap component="div">
          {t('appTitle')}
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={t(`theme.${themePreference}`) as string}>
            <IconButton size="small" onClick={(e) => setThemeAnchor(e.currentTarget)}>
              {themeIcon}
            </IconButton>
          </Tooltip>
          <Menu anchorEl={themeAnchor} open={Boolean(themeAnchor)} onClose={() => setThemeAnchor(null)}>
            <MenuItem onClick={() => { setThemePreference('light'); setThemeAnchor(null); }}>
              <LightModeIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.light')}
            </MenuItem>
            <MenuItem onClick={() => { setThemePreference('dark'); setThemeAnchor(null); }}>
              <DarkModeIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.dark')}
            </MenuItem>
            <MenuItem onClick={() => { setThemePreference('system'); setThemeAnchor(null); }}>
              <SettingsBrightnessIcon fontSize="small" style={{ marginRight: 8 }} /> {t('theme.system')}
            </MenuItem>
          </Menu>

          <Tooltip title={t('lang.' + language) as string}>
            <IconButton size="small" onClick={(e) => setLangAnchor(e.currentTarget)}>
              <TranslateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={langAnchor} open={Boolean(langAnchor)} onClose={() => setLangAnchor(null)}>
            <MenuItem onClick={() => { setLanguage('en'); setLangAnchor(null); }}>
              <span style={{ marginRight: 8 }}>🇬🇧</span> {t('lang.en')}
            </MenuItem>
            <MenuItem onClick={() => { setLanguage('th'); setLangAnchor(null); }}>
              <span style={{ marginRight: 8 }}>🇹🇭</span> {t('lang.th')}
            </MenuItem>
          </Menu>

          <Tooltip title={t('actions.logout') as string}>
            <IconButton
              size="small"
              onClick={async () => {
                try {
                  await logout();
                } finally {
                  window.location.href = '/login';
                }
              }}
              aria-label={t('actions.logout') as string}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default TopBar;

