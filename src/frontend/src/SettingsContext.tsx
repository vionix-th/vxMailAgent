import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import type { PaletteMode } from '@mui/material';

export type LanguageCode = 'en' | 'th';
export type ThemePreference = 'light' | 'dark' | 'system';

interface SettingsContextValue {
  themePreference: ThemePreference;
  effectiveMode: PaletteMode;
  setThemePreference: (mode: ThemePreference) => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
}

/** Internal context for application settings. */
const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

const THEME_KEY = 'vx_theme_pref';
const LANG_KEY = 'vx_lang';

/** Provides theme and language preferences to descendants. */
export const SettingsProvider: React.FC<{ children: React.ReactNode }>
  = ({ children }) => {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    const v = (typeof localStorage !== 'undefined') ? (localStorage.getItem(THEME_KEY) as ThemePreference | null) : null;
    return v ?? 'system';
  });

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    const v = (typeof localStorage !== 'undefined') ? (localStorage.getItem(LANG_KEY) as LanguageCode | null) : null;
    return v ?? 'en';
  });

  const effectiveMode: PaletteMode = useMemo(() => {
    if (themePreference === 'system') return prefersDark ? 'dark' : 'light';
    return themePreference;
  }, [themePreference, prefersDark]);

  const setThemePreference = (mode: ThemePreference) => {
    setThemePreferenceState(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
  };

  const setLanguage = (lang: LanguageCode) => {
    setLanguageState(lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  };

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveMode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [effectiveMode]);

  const value = useMemo(() => ({
    themePreference,
    effectiveMode,
    setThemePreference,
    language,
    setLanguage,
  }), [themePreference, effectiveMode, language]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

/** Access the current settings context. */
export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};
