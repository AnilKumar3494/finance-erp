import { type ReactNode } from 'react'
import Alert, { type AlertProps } from '@mui/material/Alert'

// Name kept for backwards compatibility — defaults to error/filled, but
// callers can drop in severity="info|warning|success" for inline alerts.
export interface ErrorBannerProps extends Omit<AlertProps, 'children'> {
  message?: ReactNode
  children?: ReactNode
}

export function ErrorBanner({
  message,
  children,
  severity = 'error',
  variant = 'filled',
  ...rest
}: ErrorBannerProps) {
  return (
    <Alert severity={severity} variant={variant} {...rest}>
      {message ?? children}
    </Alert>
  )
}
