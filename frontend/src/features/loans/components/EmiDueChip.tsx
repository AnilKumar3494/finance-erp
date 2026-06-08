import Chip from '@mui/material/Chip'
import type { ChipProps } from '@mui/material/Chip'

import type { EmiDueStatus } from '@/api/queries/loans'

const EMI_DUE_META: Record<
  Exclude<EmiDueStatus, 'NONE'>,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  DUE: { label: 'EMI due', color: 'warning' },
  OVERDUE: { label: 'Overdue', color: 'error' },
  AWAITING_CONFIRMATION: { label: 'Awaiting confirmation', color: 'info' },
}

// Secondary chip that flags an EMI needing attention, shown alongside the loan
// status chip. Renders nothing when there's nothing due (status NONE).
export function EmiDueChip({
  status,
  size = 'small',
}: {
  status: EmiDueStatus
  size?: 'small' | 'medium'
}) {
  // Defensive: also render nothing for NONE or any value the backend hasn't
  // started sending yet (the field is absent until the API change is deployed).
  const meta = status === 'NONE' ? undefined : EMI_DUE_META[status]
  if (!meta) return null
  return (
    <Chip
      size={size}
      label={meta.label}
      color={meta.color}
      variant="outlined"
      sx={{ fontWeight: 600 }}
    />
  )
}
