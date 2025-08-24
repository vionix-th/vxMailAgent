import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OAuthCallback from './OAuthCallback';
import './index.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import createAppTheme from './theme';
import { SettingsProvider, useSettings } from './SettingsContext';
import i18n from './i18n';

const Root: React.FC = () => {
  const { effectiveMode, language } = useSettings();
  const muiTheme = React.useMemo(() => createAppTheme(effectiveMode), [effectiveMode]);
  React.useEffect(() => { i18n.changeLanguage(language); }, [language]);
  return (
    <ThemeProvider theme={muiTheme}>
      <BrowserRouter>
        <Routes>
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  </React.StrictMode>
);
