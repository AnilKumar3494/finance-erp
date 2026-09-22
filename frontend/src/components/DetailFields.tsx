import { type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// Responsive two-column grid for label/value pairs. Shared by every read-only
// section on the finance page.
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: { xs: 1.5, sm: 2.5 },
      }}
    >
      {children}
    </Box>
  )
}

export function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const hasValue = value !== null && value !== undefined && value !== ''
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          color: hasValue ? 'text.primary' : 'text.secondary',
        }}
      >
        {hasValue ? value : '—'}
      </Typography>
    </Box>
  )
}
