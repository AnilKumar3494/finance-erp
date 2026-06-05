import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import MenuOutlined from '@mui/icons-material/MenuOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'

import { useThemeMode } from '@/hooks/useTheme'
import { usePageTitle } from './navUtils'

interface MobileTopBarProps {
  onOpenDrawer: () => void
}

export function MobileTopBar({ onOpenDrawer }: MobileTopBarProps) {
  const { mode, toggle } = useThemeMode()
  const title = usePageTitle()

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (t) => t.zIndex.appBar,
        // Opaque base + surface overlay so scrolled content never shows
        // through (background.paper is translucent in dark mode).
        bgcolor: 'var(--bg)',
        backgroundImage: 'linear-gradient(var(--surface), var(--surface))',
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
