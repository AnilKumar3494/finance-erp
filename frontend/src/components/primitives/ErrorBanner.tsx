import { type ReactNode } from 'react'
import Alert, { type AlertProps } from '@mui/material/Alert'

export interface ErrorBannerProps extends Omit<AlertProps, 'severity' | 'children'> {
  message?: ReactNode
  children?: ReactNode
}

export function ErrorBanner({ message, children, ...rest }: ErrorBannerProps) {
  return (
    <Alert severity="error" variant="filled" {...rest}>
      {message ?? children}
    </Alert>
  )
}
