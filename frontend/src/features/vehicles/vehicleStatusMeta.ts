import type { ChipProps } from '@mui/material/Chip'

import type { AssetStatus, AssetType } from '@/schemas/enums'

// Status chip meta for vehicles — mirrors loanStatusMeta.ts. WITH_CUSTOMER is
// pledged collateral physically held by the hirer (set by the Finance wizard);
// SOLD is terminal in the backend state machine.
export const VEHICLE_STATUS_META: Record<
  AssetStatus,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  IN_YARD: { label: 'In yard', color: 'success' },
  WITH_CUSTOMER: { label: 'With customer', color: 'info' },
  MAINTENANCE: { label: 'Maintenance', color: 'warning' },
  SEIZED: { label: 'Seized', color: 'warning' },
  SOLD: { label: 'Sold', color: 'default' },
}

// Order used for the list filter chips and the status dropdown.
export const ASSET_STATUS_ORDER: AssetStatus[] = [
  'IN_YARD',
  'WITH_CUSTOMER',
  'MAINTENANCE',
  'SEIZED',
  'SOLD',
]

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  INVENTORY: 'Inventory',
  COLLATERAL: 'Collateral',
}
