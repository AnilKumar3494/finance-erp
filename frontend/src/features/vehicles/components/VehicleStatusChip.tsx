import Chip from '@mui/material/Chip'

import type { AssetStatus } from '@/schemas/enums'
import { VEHICLE_STATUS_META } from '../vehicleStatusMeta'

interface VehicleStatusChipProps {
  status: AssetStatus
  size?: 'small' | 'medium'
}

export function VehicleStatusChip({ status, size = 'small' }: VehicleStatusChipProps) {
  const meta = VEHICLE_STATUS_META[status]
  return <Chip size={size} label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}
