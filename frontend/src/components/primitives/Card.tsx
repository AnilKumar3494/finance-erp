import Paper, { type PaperProps } from '@mui/material/Paper'

export type CardProps = PaperProps

export function Card({ sx, children, ...rest }: CardProps) {
  // Array form preserves caller-supplied function/array sx, which the prior
  // object-spread merge silently dropped.
  return (
    <Paper sx={[{ p: 3 }, ...(Array.isArray(sx) ? sx : [sx])]} {...rest}>
      {children}
    </Paper>
  )
}
