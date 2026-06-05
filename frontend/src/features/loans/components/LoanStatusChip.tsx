import Chip from '@mui/material/Chip'

import type { LoanStatus } from '@/schemas/enums'
import { LOAN_STATUS_META } from '../loanStatusMeta'

interface LoanStatusChipProps {
  status: LoanStatus
  size?: 'small' | 'medium'
}

export function LoanStatusChip({ status, size = 'small' }: LoanStatusChipProps) {
  const meta = LOAN_STATUS_META[status]
  return <Chip size={size} label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}
