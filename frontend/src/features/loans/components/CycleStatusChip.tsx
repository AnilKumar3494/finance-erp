import Chip from '@mui/material/Chip'

import type { CycleStatus } from '@/schemas/enums'
import { CYCLE_STATUS_META } from '../cycleStatusMeta'

export function CycleStatusChip({ status }: { status: CycleStatus }) {
  const meta = CYCLE_STATUS_META[status]
  return <Chip size="small" label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}
