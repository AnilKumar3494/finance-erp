/**
 * Root providers.
 *
 * Wraps the entire app with:
 *   - React Query (server-state cache; persists during the SPA session)
 *   - MUI ThemeProvider + CssBaseline (built from CSS variables in tokens.css)
 *   - MUI LocalizationProvider (dayjs)
 *
 * Theme mode (light/dark) is owned by useThemeMode, which also writes
 * `data-theme` on <html> so non-MUI styles pick up the swap.
 */

import { useMemo, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

import { buildMuiTheme } from '@/styles/mui-theme'
import { useThemeMode } from '@/hooks/useTheme'

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
  const { mode } = useThemeMode()

  // Rebuild the MUI theme when mode changes so it re-reads CSS variables.
  const theme = useMemo(() => buildMuiTheme(mode), [mode])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
