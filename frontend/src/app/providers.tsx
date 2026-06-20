/**
 * Root providers.
 *
 * Wraps the entire app with:
 *   - ThemeModeProvider (single source of truth for light/dark)
 *   - React Query (server-state cache; persists during the SPA session)
 *   - MUI ThemeProvider + CssBaseline (built from CSS variables in tokens.css)
 *   - MUI LocalizationProvider (dayjs)
 *   - AuthProvider (user + login/logout)
 *
 * ThemeModeProvider sits OUTSIDE the inner providers so every consumer of
 * useThemeMode — including buttons buried deep in the route tree — reads
 * the same state. The MUI theme rebuild listens to that state.
 */

import { useMemo, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

import { buildMuiTheme } from '@/styles/mui-theme'
import { ThemeModeProvider, useThemeMode } from '@/hooks/useTheme'
import { AuthProvider } from '@/app/auth-context'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Financial data: short stale time, no aggressive refetching.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <InnerProviders>{children}</InnerProviders>
    </ThemeModeProvider>
  )
}

function InnerProviders({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode()

  // Rebuild the MUI theme when mode changes so it re-reads CSS variables.
  const theme = useMemo(() => buildMuiTheme(mode), [mode])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <AuthProvider>{children}</AuthProvider>
        </LocalizationProvider>
      </ThemeProvider>
      {/* Dev-only: stripped from prod builds (import.meta.env.DEV is statically
          false there, so the devtools and their import are tree-shaken out). */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
