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
  // Non-blocking warning message: draws a yellow outline + amber message below
  // the field but does NOT prevent submit. Use for advisory checks (e.g. a
  // non-standard vehicle plate that should still be saved). An `error` wins.
  warning?: string
  // Draws a warning (yellow) outline to flag a required-but-missing field —
  // used by the approval walk-through. An actual `error` takes precedence.
  highlight?: boolean
}

// What a highlighted field says instead of its usual placeholder. A field
// flagged by the approval walk-through is not optional any more — saying
// "Optional" there contradicts the outline drawn around it.
const REQUIRED_TO_APPROVE = 'Required to Approve the Loan'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, error, hint, warning, highlight, id, sx, placeholder, ...rest },
  ref,
) {
  const showWarning = !!warning && !error
  // Highlighted fields are required-to-approve: they carry the asterisk even
  // when the base schema treats them as optional, and say so in the placeholder
  // whatever the call site passed.
  const isBlocking = !!highlight
  const shownPlaceholder = isBlocking ? REQUIRED_TO_APPROVE : placeholder
  const highlightSx =
    (highlight || showWarning) && !error
      ? {
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
          '& .Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--warning)' },
        }
      : null

  return (
    <Box>
      {label && (
        <FieldLabel htmlFor={id} required={required || isBlocking}>
          {label}
        </FieldLabel>
      )}
      <TextField
        id={id}
        inputRef={ref}
        error={!!error}
        fullWidth
        size="small"
        placeholder={shownPlaceholder}
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
      ) : showWarning ? (
        <Typography
          sx={{
            mt: 0.5,
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--warning)',
          }}
        >
          {warning}
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
