/**
 * Theme mode controller.
 *
 * Local UI state (not server state) — useState is the right primitive here.
 * No useEffect: DOM + storage writes happen synchronously inside the setters,
 * and the initial mode is applied at module load before React mounts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { themeStorage } from '@/lib/storage'

export type ThemeMode = 'light' | 'dark'

interface ThemeModeContextValue {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  toggle: () => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined)

function readInitialMode(): ThemeMode {
  const stored = themeStorage.get()
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'
}

function applyMode(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

// Apply initial mode to <html> at module load so the first paint is correct.
// The `typeof document` guard inside applyMode makes this a no-op on the server.
applyMode(readInitialMode())

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<ThemeMode>(readInitialMode)

  const setMode = useCallback((m: ThemeMode) => {
    applyMode(m)
    themeStorage.set(m)
    setModeRaw(m)
  }, [])

  const toggle = useCallback(() => {
    setModeRaw((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      applyMode(next)
      themeStorage.set(next)
      return next
    })
  }, [])

  const value = useMemo<ThemeModeContextValue>(
    () => ({ mode, setMode, toggle }),
    [mode, setMode, toggle],
  )

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext)
  if (!ctx) throw new Error('useThemeMode must be used within a ThemeModeProvider')
  return ctx
}
