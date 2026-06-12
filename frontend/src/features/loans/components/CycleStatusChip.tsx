import Chip from '@mui/material/Chip'

import type { CycleStatus } from '@/schemas/enums'
import { CYCLE_STATUS_META } from '../cycleStatusMeta'
import type { CycleDisplay } from '../cycleDisplay'

// CycleStatusChip renders either:
//   - a raw CycleStatus (legacy / worklist callers without a derived display),
//     via the `status` prop, OR
//   - a derived CycleDisplay (the richer state including PENDING_CONFIRMATION
//     and PAID_IN_ADVANCE) via the `display` prop. Pass an `onClick` to make
//     it clickable — typically only meaningful for the PENDING_CONFIRMATION
//     state, where the click jumps to the awaiting transaction.
type Props =
  | {
      status: CycleStatus
      display?: never
      onClick?: never
    }
  | {
      status?: never
      display: CycleDisplay
      onClick?: (display: CycleDisplay) => void
    }

export function CycleStatusChip(props: Props) {
  if (props.status) {
    const meta = CYCLE_STATUS_META[props.status]
    return (
      <Chip
        size="small"
        label={meta.label}
        color={meta.color}
        variant={meta.variant}
        sx={{ fontWeight: 500 }}
      />
    )
  }

  const { display, onClick } = props
  const meta = CYCLE_STATUS_META[display.key]
  const clickable = !!onClick
  return (
    <Chip
      size="small"
      label={meta.label}
      color={meta.color}
      variant={meta.variant}
      onClick={clickable ? () => onClick!(display) : undefined}
      sx={{
        fontWeight: 500,
        // The default MUI clickable chip styling is subtle to the point of
        // missing on a busy schedule row. Bump the cursor and a subtle
        // affordance so the user knows the chip does something.
        ...(clickable && {
          cursor: 'pointer',
          '&:hover': { filter: 'brightness(0.95)' },
        }),
      }}
    />
  )
}
