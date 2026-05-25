/**
 * Theme mode controller.
 *
 * Reads/writes 'light' | 'dark' in localStorage and reflects it on
 * <html data-theme="…"> so tokens.css can swap CSS variables.
 * The MUI theme is rebuilt downstream in providers.tsx on mode change.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'finerp_theme';

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Default to light per spec; ignore prefers-color-scheme for now.
  return 'light';
}

function applyMode(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  // Apply on mount + whenever mode changes.
  useEffect(() => {
    applyMode(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore quota errors */
    }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, setMode, toggle };
}
