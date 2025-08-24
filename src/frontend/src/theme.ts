import { createTheme } from '@mui/material/styles';

export const createAppTheme = (mode: 'light' | 'dark') => createTheme({
  palette: {
    mode,
    ...(mode === 'light'
      // Tokyo Night Light
      ? {
          primary: { main: '#2e7de9', light: '#5aa1ff', dark: '#1f5fb9', contrastText: '#ffffff' },
          secondary: { main: '#9854f1', light: '#b48cf6', dark: '#6c3cb3', contrastText: '#ffffff' },
          success: { main: '#587539' },
          warning: { main: '#8c6c3e' },
          error: { main: '#f52a65' },
          info: { main: '#2e7de9' },
          // Less white-dominant UI: soft blue-gray canvas and off-white paper
          background: { default: '#e9ecf5', paper: '#f6f7fb' },
          divider: '#d5d9e6',
          text: { primary: '#343b58', secondary: '#565a6e' },
          action: { hover: 'rgba(52,59,88,0.05)', selected: 'rgba(46,125,233,0.12)' },
        }
      // Tokyo Night (Dark)
      : {
          primary: { main: '#7aa2f7', light: '#a0bbfb', dark: '#4c78d4', contrastText: '#0b0c14' },
          secondary: { main: '#7dcfff', light: '#a6e0ff', dark: '#4da7d6', contrastText: '#0b0c14' },
          success: { main: '#9ece6a' },
          warning: { main: '#e0af68' },
          error: { main: '#f7768e' },
          info: { main: '#7dcfff' },
          background: { default: '#1a1b26', paper: '#1f2335' },
          divider: '#2a2e45',
          text: { primary: '#c0caf5', secondary: '#a9b1d6' },
          action: { hover: 'rgba(160,187,251,0.06)', selected: 'rgba(122,162,247,0.14)' },
        }),
  },
  typography: {
    fontFamily: 'Roboto, system-ui, -apple-system, Segoe UI, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    h1: { fontWeight: 700, letterSpacing: -0.5, fontSize: '2rem' },
    h2: { fontWeight: 700, letterSpacing: -0.4, fontSize: '1.6rem' },
    h3: { fontWeight: 700, letterSpacing: -0.2, fontSize: '1.35rem' },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
    body2: { letterSpacing: 0 },
    caption: { letterSpacing: 0 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '::-webkit-scrollbar': {
          width: 10,
          height: 10,
        },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: mode === 'light' ? '#c5c9d7' : '#2a2e45',
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'padding-box',
        },
        '::-webkit-scrollbar-track': {
          backgroundColor: mode === 'light' ? '#e1e2e7' : '#1a1b26',
          borderRadius: 8,
        },
      },
    },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
    MuiList: { defaultProps: { dense: true } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          '&.Mui-selected': {
            backgroundColor: 'rgba(79,70,229,0.08)',
          },
          '&.Mui-selected:hover': {
            backgroundColor: 'rgba(79,70,229,0.12)',
          },
          position: 'relative',
          '&.Mui-selected::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 2,
            backgroundColor: '#4f46e5',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        colorDefault: mode === 'light'
          ? {
              backgroundColor: '#ffffff',
              color: '#343b58',
              boxShadow: 'none',
              borderBottom: '1px solid #cdd5e1',
              backdropFilter: 'saturate(180%) blur(6px)',
              borderRadius: 0,
              overflow: 'visible',
            }
          : {
              backgroundColor: '#1f2335',
              color: '#c0caf5',
              boxShadow: 'none',
              borderBottom: '1px solid #2a2e45',
              backdropFilter: 'saturate(180%) blur(6px)',
              borderRadius: 0,
              overflow: 'visible',
            },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: mode === 'light'
          ? {
              backgroundColor: '#ffffff',
              backgroundImage: 'linear-gradient(180deg, rgba(2,0,36,0) 0%, rgba(46,125,233,0.06) 100%)',
              border: 'none',
              borderRight: '1px solid #cdd5e1',
              borderRadius: 0,
              overflow: 'visible',
            }
          : {
              backgroundColor: '#1f2335',
              backgroundImage: 'linear-gradient(180deg, rgba(2,0,36,0) 0%, rgba(122,162,247,0.10) 100%)',
              border: 'none',
              borderRight: '1px solid #2a2e45',
              borderRadius: 0,
              overflow: 'visible',
            },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid',
          borderColor: 'divider',
        },
      },
    },
    MuiButton: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { borderRadius: 10, fontWeight: 600 },
        contained: { boxShadow: 'none' },
        outlined: { borderWidth: 1.5, '&:hover': { borderWidth: 1.5 } },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiInputBase: {
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: mode === 'light' ? '#e2e8f0' : '#1f2937',
        },
      },
    },
  },
});

export default createAppTheme;
