import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import Avatar from '@mui/material/Avatar'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'

import { useAuth } from '@/app/auth-context'
import { BRAND, NAV_ITEMS, type NavItem } from './navConfig'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
}

function isActive(currentPath: string, itemPath: NavItem['path']): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

function getInitials(source: string | null | undefined, fallback: string): string {
  const name = (source ?? '').trim()
  if (!name) return fallback.slice(0, 2).toUpperCase()
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const currentPath = useRouterState({ select: (s) => s.location.pathname })

  const handleLogout = () => {
    onClose()
    logout()
    navigate({ to: '/login' })
  }

  const initials = getInitials(user?.full_name, user?.username ?? '?')

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: 280,
            // Layer: opaque page bg below, sidebar tone on top.
            // The bare --sidebar token is intentionally translucent in dark
            // mode (designed to sit over the page bg). A Drawer floats over
            // a backdrop, so without this base it would look see-through.
            bgcolor: 'var(--bg)',
            backgroundImage: 'linear-gradient(var(--sidebar), var(--sidebar))',
            color: 'var(--sidebar-text)',
            border: 0,
          },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          height: 56,
          borderBottom: '1px solid var(--sidebar-hover)',
        }}
      >
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
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="Close navigation"
          sx={{
            color: 'var(--sidebar-text)',
            '&:hover': {
              color: 'var(--sidebar-text-strong)',
              bgcolor: 'var(--sidebar-hover)',
            },
          }}
        >
          <CloseOutlined fontSize="small" />
        </IconButton>
      </Stack>

      <Stack component="nav" spacing={0.5} sx={{ flex: 1, px: 1, py: 1.5, overflowY: 'auto' }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(currentPath, item.path)
          const Icon = item.icon
          return (
            <Stack
              key={item.path}
              direction="row"
              spacing={1.5}
              component={Link}
              to={item.path}
              onClick={onClose}
              sx={{
                alignItems: 'center',
                textDecoration: 'none',
                px: 1.5,
                py: 1.25,
                borderRadius: 'var(--radius-md)',
                color: active ? 'var(--sidebar-active-text)' : 'var(--sidebar-text)',
                bgcolor: active ? 'var(--sidebar-active)' : 'transparent',
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon sx={{ fontSize: 22 }} />
              <Typography sx={{ fontSize: 15, fontWeight: 'inherit', color: 'inherit' }}>
                {item.label}
              </Typography>
            </Stack>
          )
        })}
      </Stack>

      <Divider sx={{ borderColor: 'var(--sidebar-hover)' }} />

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', px: 2, py: 1.5 }}
      >
        <Avatar
          sx={{
            width: 36,
            height: 36,
            bgcolor: 'var(--sidebar-active)',
            color: 'var(--sidebar-active-text)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {initials}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              color: 'var(--sidebar-text-strong)',
              fontSize: 13,
              fontWeight: 600,
            }}
            noWrap
          >
            {user?.full_name?.trim() || user?.username || '—'}
          </Typography>
          <Typography sx={{ color: 'var(--sidebar-text)', fontSize: 11 }} noWrap>
            {user?.username ? `@${user.username}` : ''}
            {user?.username && user?.role ? ' · ' : ''}
            {user?.role ?? ''}
          </Typography>
        </Box>
        <IconButton
          onClick={handleLogout}
          aria-label="Logout"
          sx={{
            color: 'var(--sidebar-text)',
            '&:hover': {
              color: 'var(--sidebar-text-strong)',
              bgcolor: 'var(--sidebar-hover)',
            },
          }}
        >
          <LogoutOutlined fontSize="small" />
        </IconButton>
      </Stack>
    </Drawer>
  )
}
