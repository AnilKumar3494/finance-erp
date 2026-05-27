import CircularProgress, { type CircularProgressProps } from '@mui/material/CircularProgress'

export interface SpinnerProps extends CircularProgressProps {
  size?: number
}

export function Spinner({ size = 20, ...rest }: SpinnerProps) {
  return <CircularProgress size={size} {...rest} />
}
