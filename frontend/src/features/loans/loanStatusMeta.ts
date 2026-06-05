import type { ChipProps } from '@mui/material/Chip'

import type { LoanStatus } from '@/schemas/enums'

export const LOAN_STATUS_META: Record<
  LoanStatus,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  DRAFT: { label: 'Draft', color: 'default' },
  ACTIVE: { label: 'Active', color: 'success' },
  AWAITING_CLOSURE: { label: 'Awaiting closure', color: 'info' },
  CLOSED: { label: 'Closed', color: 'default' },
  BAD_DEBT_PROPOSED: { label: 'Bad debt proposed', color: 'warning' },
  BAD_DEBT: { label: 'Bad debt', color: 'error' },
}

export const LOAN_STATUS_ORDER: LoanStatus[] = [
  'DRAFT',
  'ACTIVE',
  'AWAITING_CLOSURE',
  'CLOSED',
  'BAD_DEBT_PROPOSED',
  'BAD_DEBT',
]
