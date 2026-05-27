import { useCallback, useRef, useState, type ReactNode } from 'react'
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
  // Remember the element that opened the drawer so we can return focus to
  // it after close. MUI's auto-restore-focus relies on the trigger being
  // focused when the Modal mounts, but we blur it first to avoid the
  // aria-hidden warning, so we own the restore explicitly.
  const triggerRef = useRef<HTMLElement | null>(null)

  const toggleCollapsed = useCallback(() => {
    setCollapsedRaw((prev) => {
      const next = !prev
      sidebarStorage.set(next ? '1' : '0')
      return next
    })
  }, [])

  const openDrawer = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
      document.activeElement.blur()
    }
    setDrawerOpen(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    const t = triggerRef.current
    triggerRef.current = null
    if (t) {
      requestAnimationFrame(() => t.focus())
    }
  }, [])

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
