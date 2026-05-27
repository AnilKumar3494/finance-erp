import { useState, type MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Avatar from '@mui/material/Avatar'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import { useNavigate, useRouterState } from '@tanstack/react-router'

import { useAuth } from '@/app/auth-context'
import { useThemeMode } from '@/hooks/useTheme'

function getInitials(source: string | null | undefined, fallback: string): string {
  const name = (source ?? '').trim()
  if (!name) return fallback.slice(0, 2).toUpperCase()
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function TopBar() {
  const { user, logout } = useAuth()
  const { mode, toggle } = useThemeMode()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const title = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const t = s.matches[i]?.staticData?.title
        if (t) return t
      }
      return ''
    },
  })

  const open = Boolean(anchor)
  const openMenu = (e: MouseEvent<HTMLElement>) => {
    const trigger = e.currentTarget
    setAnchor(trigger)
    // Same a11y reason as the mobile drawer: blur the trigger so it isn't
    // focused inside an aria-hidden subtree while the Menu mounts.
    trigger.blur()
  }
  const closeMenu = () => setAnchor(null)
  const handleLogout = () => {
    closeMenu()
    logout()
    navigate({ to: '/login' })
  }

  const initials = getInitials(user?.full_name, user?.username ?? '?')

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (t) => t.zIndex.appBar,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        height: 64,
        px: 3,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Typography variant="h2" sx={{ flex: 1, minWidth: 0, color: 'text.primary' }} noWrap>
        {title}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton onClick={toggle} size="small" aria-label="Toggle theme">
            {mode === 'dark' ? (
              <LightModeOutlined fontSize="small" />
            ) : (
              <DarkModeOutlined fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        <Tooltip title="Account">
          <IconButton onClick={openMenu} size="small" aria-label="Account menu">
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {initials}
            </Avatar>
          </IconButton>
        </Tooltip>
      </Stack>

      <Menu
        anchorEl={anchor}
        open={open}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220, mt: 0.5 } } }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 13, color: 'text.primary' }} noWrap>
            {user?.full_name?.trim() || user?.username || '—'}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
            {user?.username ? `@${user.username}` : ''}
            {user?.username && user?.role ? ' · ' : ''}
            {user?.role ?? ''}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogoutOutlined fontSize="small" />
          </ListItemIcon>
          Logout
        </MenuItem>
      </Menu>
    </Box>
  )
}
