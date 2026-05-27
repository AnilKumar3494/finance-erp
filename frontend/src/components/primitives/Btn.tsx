import { forwardRef } from 'react'
import Button, { type ButtonProps } from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'

export type BtnVariant = 'primary' | 'ghost' | 'success' | 'danger'
export type BtnSize = 'sm' | 'md'

export interface BtnProps extends Omit<ButtonProps, 'variant' | 'color' | 'size'> {
  variant?: BtnVariant
  size?: BtnSize
  loading?: boolean
}

const VARIANT_MAP: Record<
  BtnVariant,
  { variant: ButtonProps['variant']; color: ButtonProps['color'] }
> = {
  primary: { variant: 'contained', color: 'primary' },
  ghost: { variant: 'text', color: 'primary' },
  success: { variant: 'contained', color: 'success' },
  danger: { variant: 'contained', color: 'error' },
}

const SIZE_MAP: Record<BtnSize, ButtonProps['size']> = {
  sm: 'small',
  md: 'medium',
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { variant = 'primary', size = 'md', loading = false, disabled, children, ...rest },
  ref,
) {
  const v = VARIANT_MAP[variant]
  return (
    <Button
      ref={ref}
      variant={v.variant}
      color={v.color}
      size={SIZE_MAP[size]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <CircularProgress size={16} color="inherit" /> : children}
    </Button>
  )
})
