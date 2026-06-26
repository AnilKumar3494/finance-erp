import { useEffect, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreOutlined'

import { Card } from '@/components/primitives'

// A plain (non-editable) section card that collapses, matching EditableSection.
// Defaults to collapsed so the detail page stays scannable. An optional header
// `action` (e.g. a print button) is rendered on the right and doesn't toggle.
// `openSignal` mirrors EditableSection's pattern: a parent bumps it (typically
// by incrementing a useState number) to imperatively force the card open
// without seizing control of its open/closed state. Used by LoanSubResources
// when a cycle's "Pending confirmation" chip targets a transaction inside the
// (otherwise collapsed) Transactions card.
export function CollapsibleCard({
  title,
  subtitle,
  action,
  children,
  defaultOpen = false,
  openSignal,
}: {
  title: string
  // Quick-info line shown under the title (visible while collapsed), matching
  // EditableSection's subtitle so every section previews its contents.
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  openSignal?: number
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (openSignal !== undefined) setOpen(true)
  }, [openSignal])

  return (
    <Card>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: open ? 2 : 0 }}
      >
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen((v) => !v)
            }
          }}
          sx={{
            minWidth: 0,
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          aria-expanded={open}
        >
          <ExpandMoreIcon
            sx={{
              color: 'text.secondary',
              transition: 'transform 150ms',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3">{title}</Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>
      <Collapse in={open} unmountOnExit>
        {children}
      </Collapse>
    </Card>
  )
}
