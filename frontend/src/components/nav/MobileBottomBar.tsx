import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined'
import { Link, useRouterState } from '@tanstack/react-router'

import { NAV_ITEMS, type NavItem } from './navConfig'

interface MobileBottomBarProps {
  onOpenDrawer: () => void
}

function isActive(currentPath: string, itemPath: NavItem['path']): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

const BOTTOM_ITEMS = NAV_ITEMS.filter((i) => i.showInBottomBar)

export function MobileBottomBar({ onOpenDrawer }: MobileBottomBarProps) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
  const otherActive = NAV_ITEMS.some(
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
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        height: 'var(--bottombar-h-mobile)',
        display: 'flex',
      }}
    >
      {BOTTOM_ITEMS.map((item) => {
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
