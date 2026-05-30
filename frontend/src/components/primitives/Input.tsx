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
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, error, hint, id, ...rest },
  ref,
) {
  return (
    <Box>
      {label && (
        <FieldLabel htmlFor={id} required={required}>
          {label}
        </FieldLabel>
      )}
      <TextField id={id} inputRef={ref} error={!!error} fullWidth size="small" {...rest} />
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
