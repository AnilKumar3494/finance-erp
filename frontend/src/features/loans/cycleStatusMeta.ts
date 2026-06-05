import type { ChipProps } from '@mui/material/Chip'

import type { CycleStatus } from '@/schemas/enums'

export const CYCLE_STATUS_META: Record<
  CycleStatus,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  UPCOMING: { label: 'Upcoming', color: 'default' },
  AWAITING_REVIEW: { label: 'Awaiting review', color: 'warning' },
  PAID_ON_TIME: { label: 'Paid on time', color: 'success' },
  LATE_PAYMENT: { label: 'Late payment', color: 'warning' },
  MISSED_CAPPED: { label: 'Missed (capped)', color: 'error' },
}
