import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'
import { Link } from '@tanstack/react-router'

import { BRAND } from './navConfig'
import { isActive, useCurrentPath, useVisibleNavItems } from './navUtils'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const currentPath = useCurrentPath()
  const navItems = useVisibleNavItems()
  const width = collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)'

  return (
    <Box
      component="aside"
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width,
        bgcolor: 'var(--sidebar)',
        color: 'var(--sidebar-text)',
        transition: 'width var(--t-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: (t) => t.zIndex.drawer,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: collapsed ? 0 : 2,
          height: 64,
          flexShrink: 0,
          borderBottom: '1px solid var(--sidebar-hover)',
        }}
      >
        {collapsed ? (
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 'var(--radius-sm)',
              bgcolor: 'var(--sidebar-active)',
              color: 'var(--sidebar-active-text)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {BRAND.short}
          </Box>
        ) : (
          <Typography
            sx={{
              color: 'var(--sidebar-text-strong)',
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            {BRAND.full}
          </Typography>
        )}
      </Stack>

      <Stack
        component="nav"
        spacing={0.5}
        sx={{ flex: 1, px: collapsed ? 0.5 : 1, py: 1.5, overflowY: 'auto' }}
      >
        {navItems.map((item) => {
          const active = isActive(currentPath, item.path)
          const Icon = item.icon
          const row = (
            <Stack
              key={item.path}
              direction="row"
              spacing={collapsed ? 0 : 1.5}
              component={Link}
              to={item.path}
              sx={{
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                textDecoration: 'none',
                px: collapsed ? 0 : 1.25,
                py: 1,
                borderRadius: 'var(--radius-md)',
                color: active
                  ? 'var(--sidebar-active-text)'
                  : 'var(--sidebar-text)',
                bgcolor: active ? 'var(--sidebar-active)' : 'transparent',
                fontWeight: active ? 600 : 500,
                transition: 'background var(--t-fast), color var(--t-fast)',
                '&:hover': {
                  bgcolor: active ? 'var(--sidebar-active)' : 'var(--sidebar-hover)',
                  color: 'var(--sidebar-text-strong)',
                },
              }}
            >
              <Icon sx={{ fontSize: 20 }} />
              {!collapsed && (
                <Typography sx={{ fontSize: 13.5, fontWeight: 'inherit', color: 'inherit' }}>
                  {item.label}
                </Typography>
              )}
            </Stack>
          )
          return collapsed ? (
            <Tooltip key={item.path} title={item.label} placement="right" arrow>
              {row}
            </Tooltip>
          ) : (
            row
          )
        })}
      </Stack>

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          px: 1,
          py: 1,
          borderTop: '1px solid var(--sidebar-hover)',
          flexShrink: 0,
        }}
      >
        <Tooltip title={collapsed ? 'Expand' : 'Collapse'} placement="right" arrow>
          <IconButton
            onClick={onToggle}
            size="small"
            sx={{
              color: 'var(--sidebar-text)',
              '&:hover': { color: 'var(--sidebar-text-strong)', bgcolor: 'var(--sidebar-hover)' },
            }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRightOutlined fontSize="small" /> : <ChevronLeftOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
