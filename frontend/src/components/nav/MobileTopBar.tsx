import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import MenuOutlined from '@mui/icons-material/MenuOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import { useRouterState } from '@tanstack/react-router'

import { useThemeMode } from '@/hooks/useTheme'

interface MobileTopBarProps {
  onOpenDrawer: () => void
}

export function MobileTopBar({ onOpenDrawer }: MobileTopBarProps) {
  const { mode, toggle } = useThemeMode()
  const title = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const t = s.matches[i]?.staticData?.title
        if (t) return t
      }
      return ''
    },
  })

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
        height: 'var(--topbar-h-mobile)',
        px: 1,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
        <IconButton onClick={onOpenDrawer} aria-label="Open navigation" size="medium">
          <MenuOutlined />
        </IconButton>
        <Typography
          sx={{
            fontSize: 16,
            fontWeight: 700,
            color: 'text.primary',
            ml: 0.5,
            minWidth: 0,
          }}
          noWrap
        >
          {title}
        </Typography>
      </Stack>

      <IconButton onClick={toggle} size="medium" aria-label="Toggle theme">
        {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
      </IconButton>
    </Box>
  )
}
