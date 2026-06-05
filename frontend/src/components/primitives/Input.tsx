import { forwardRef } from 'react'
import Box from '@mui/material/Box'
import TextField, { type TextFieldProps } from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { FieldLabel } from './FieldLabel'

export interface InputProps extends Omit<TextFieldProps, 'label' | 'error' | 'helperText'> {
  label?: string
  required?: boolean
  // String message (not boolean) — TextField gets `error={!!error}` for the
  // red-border state, and we render the message below per §7 style spec.
  error?: string
  // Muted helper text shown below the input when no error is present.
  hint?: string
  // Draws a warning (yellow) outline to flag a required-but-missing field —
  // used by the approval walk-through. An actual `error` takes precedence.
  highlight?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, error, hint, highlight, id, sx, ...rest },
  ref,
) {
  const highlightSx =
    highlight && !error
      ? {
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
          '& .Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
        }
      : null

  return (
    <Box>
      {label && (
        <FieldLabel htmlFor={id} required={required}>
          {label}
        </FieldLabel>
      )}
      <TextField
        id={id}
        inputRef={ref}
        error={!!error}
        fullWidth
        size="small"
        sx={[highlightSx, ...(Array.isArray(sx) ? sx : [sx])]}
        {...rest}
      />
      {error ? (
        <Typography
          role="alert"
          sx={{
            mt: 0.5,
            fontSize: 11,
            fontWeight: 500,
            color: 'error.main',
          }}
        >
          {error}
        </Typography>
      ) : hint ? (
        <Typography
          sx={{
            mt: 0.5,
            fontSize: 11,
            color: 'text.secondary',
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
  )
})
