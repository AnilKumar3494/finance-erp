import Chip from '@mui/material/Chip'

import type { LoanStatus } from '@/schemas/enums'
import { LOAN_STATUS_META } from '../loanStatusMeta'

interface LoanStatusChipProps {
  status: LoanStatus
  size?: 'small' | 'medium'
  // When provided, the chip becomes a button (e.g. jump to the loan actions
  // for a status that needs one, like Bad debt proposed → review).
  onClick?: () => void
  title?: string
}

export function LoanStatusChip({ status, size = 'small', onClick, title }: LoanStatusChipProps) {
  const meta = LOAN_STATUS_META[status]
  return (
    <Chip
      size={size}
      label={meta.label}
      color={meta.color}
      onClick={onClick}
      title={title}
      sx={{ fontWeight: 500, ...(onClick ? { cursor: 'pointer' } : null) }}
    />
  )
}
