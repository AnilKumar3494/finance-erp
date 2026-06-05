import { useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreOutlined'

// A lightweight collapsible block: a clickable header that toggles a body.
// Used to fold long document/upload areas so a section stays scannable.
export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.5,
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': { bgcolor: 'var(--surface-alt)' },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" sx={{ fontSize: 15 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <ExpandMoreIcon
          sx={{
            color: 'text.secondary',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--t-fast)',
          }}
        />
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box sx={{ p: 2, pt: 0 }}>{children}</Box>
      </Collapse>
    </Box>
  )
}
