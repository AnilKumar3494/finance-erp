import Paper, { type PaperProps } from '@mui/material/Paper'

export type CardProps = PaperProps

export function Card({ sx, children, ...rest }: CardProps) {
  return (
    <Paper sx={{ p: 3, ...sx }} {...rest}>
      {children}
    </Paper>
  )
}
