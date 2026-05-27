import { useCallback, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

import { sidebarStorage } from '@/lib/storage'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileTopBar } from './MobileTopBar'
import { MobileBottomBar } from './MobileBottomBar'
import { MobileDrawer } from './MobileDrawer'

function readInitialCollapsed(): boolean {
  return sidebarStorage.get() === '1'
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [collapsed, setCollapsedRaw] = useState<boolean>(readInitialCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleCollapsed = useCallback(() => {
    setCollapsedRaw((prev) => {
      const next = !prev
      sidebarStorage.set(next ? '1' : '0')
      return next
    })
  }, [])

  const openDrawer = useCallback(() => {
    // Blur the trigger before the Modal mounts. Without this, MUI sets
    // aria-hidden on the page root while the trigger button still holds
    // focus inside it, which Chrome flags as an a11y violation.
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setDrawerOpen(true)
  }, [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  if (isDesktop) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <Box
          sx={{
            marginLeft: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
            transition: 'margin-left var(--t-sidebar)',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <TopBar />
          <Box
            component="main"
            sx={{
              flex: 1,
              px: 'var(--page-pad-x)',
              pt: 'var(--page-pad-top)',
              pb: 'var(--page-pad-bottom)',
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <MobileTopBar onOpenDrawer={openDrawer} />
      <Box
        component="main"
        sx={{
          px: 2,
          pt: 2,
          pb: 'calc(var(--bottombar-h-mobile) + 16px)',
        }}
      >
        {children}
      </Box>
      <MobileBottomBar onOpenDrawer={openDrawer} />
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} />
    </Box>
  )
}
