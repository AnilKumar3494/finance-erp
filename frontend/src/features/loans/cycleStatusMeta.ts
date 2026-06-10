import type { ChipProps } from '@mui/material/Chip'

import type { CycleStatus } from '@/schemas/enums'
import type { CycleDisplayKey } from './cycleDisplay'

// Display metadata for both the raw backend CycleStatus and the two derived
// display states added in cycleDisplay.ts. Indexed by CycleDisplayKey, which
// is a superset of CycleStatus.
//
// `variant: 'outlined'` is used to differentiate PAID_IN_ADVANCE from the
// terminal PAID_ON_TIME — same colour family, lighter weight, so the user
// can tell at a glance that this cycle is paid but not yet officially
// classified for the cycle's due date.
export const CYCLE_STATUS_META: Record<
  CycleDisplayKey,
  {
    label: string
    color: NonNullable<ChipProps['color']>
    variant?: ChipProps['variant']
  }
> = {
  UPCOMING: { label: 'Upcoming', color: 'default' },
  PENDING_CONFIRMATION: { label: 'Pending confirmation', color: 'info' },
  PAID_IN_ADVANCE: { label: 'Paid in advance', color: 'success', variant: 'outlined' },
  AWAITING_REVIEW: { label: 'Awaiting review', color: 'warning' },
  PAID_ON_TIME: { label: 'Paid on time', color: 'success' },
  LATE_PAYMENT: { label: 'Late payment', color: 'warning' },
  MISSED_CAPPED: { label: 'Missed (capped)', color: 'error' },
}

// Back-compat helper for callers that still hand in a raw CycleStatus
// (e.g. the cross-loan worklist, which doesn't load per-loan transactions
// and so can't derive the richer display state).
export function metaForStatus(status: CycleStatus) {
  return CYCLE_STATUS_META[status]
}
