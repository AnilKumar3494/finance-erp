import { type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export interface FieldLabelProps {
  htmlFor?: string
  required?: boolean
  children: ReactNode
}

export function FieldLabel({ htmlFor, required, children }: FieldLabelProps) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        fontSize: 13,
        fontWeight: 500,
        color: 'text.primary',
        mb: 0.5,
      }}
    >
      {children}
      {/* Red, the near-universal convention for a mandatory field — blue read
          as decoration rather than an instruction. */}
      {required && (
        <Box component="span" aria-hidden sx={{ color: 'error.main', fontWeight: 600 }}>
          *
        </Box>
      )}
    </Typography>
  )
}
