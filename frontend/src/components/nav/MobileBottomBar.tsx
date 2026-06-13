import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined'
import { Link } from '@tanstack/react-router'

import { isActive, useCurrentPath, useVisibleNavItems } from './navUtils'

interface MobileBottomBarProps {
  onOpenDrawer: () => void
}

export function MobileBottomBar({ onOpenDrawer }: MobileBottomBarProps) {
  const currentPath = useCurrentPath()
  const navItems = useVisibleNavItems()
  const bottomItems = navItems.filter((i) => i.showInBottomBar)
  const otherActive = navItems.some(
    (i) => !i.showInBottomBar && isActive(currentPath, i.path),
  )

  return (
    <Box
      component="nav"
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (t) => t.zIndex.appBar,
        // Opaque base + surface overlay so scrolled content never shows
        // through (background.paper is translucent in dark mode).
        bgcolor: 'var(--bg)',
        backgroundImage: 'linear-gradient(var(--surface), var(--surface))',
        borderTop: '1px solid',
        borderColor: 'divider',
        height: 'var(--bottombar-h-mobile)',
        display: 'flex',
      }}
    >
      {bottomItems.map((item) => {
        const active = isActive(currentPath, item.path)
        const Icon = item.icon
        return (
          <Stack
            key={item.path}
            component={Link}
            to={item.path}
            sx={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              color: active ? 'primary.main' : 'text.secondary',
              gap: 0.25,
              transition: 'color var(--t-fast)',
            }}
          >
            <Icon sx={{ fontSize: 22 }} />
            <Typography
              sx={{ fontSize: 10.5, fontWeight: active ? 700 : 500, color: 'inherit' }}
            >
              {item.label}
            </Typography>
          </Stack>
        )
      })}

      <Stack
        component="button"
        onClick={onOpenDrawer}
        sx={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: otherActive ? 'primary.main' : 'text.secondary',
          gap: 0.25,
          font: 'inherit',
          p: 0,
        }}
        aria-label="More navigation"
      >
        <MoreHorizOutlined sx={{ fontSize: 22 }} />
        <Typography sx={{ fontSize: 10.5, fontWeight: otherActive ? 700 : 500, color: 'inherit' }}>
          More
        </Typography>
      </Stack>
    </Box>
  )
}
