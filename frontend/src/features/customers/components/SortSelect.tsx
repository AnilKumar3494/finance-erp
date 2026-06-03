import MenuItem from '@mui/material/MenuItem'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import SortIcon from '@mui/icons-material/SortOutlined'

import type { CustomerSortField, SortOrder } from '@/api/queries/customers'

export interface SortOption {
  value: string
  label: string
  sort_by: CustomerSortField
  sort_order: SortOrder
}

// One option per state the column headers can produce. Keeping these
// 1-1 with the sortable headers means the Select always faithfully
// reflects the URL — there's no combination of header clicks that lands
// in a state the dropdown can't label.
export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'created_at:desc', label: 'Newest first', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest first', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'full_name:asc', label: 'Name (A → Z)', sort_by: 'full_name', sort_order: 'asc' },
  { value: 'full_name:desc', label: 'Name (Z → A)', sort_by: 'full_name', sort_order: 'desc' },
  {
    value: 'assigned_employee_name:asc',
    label: 'Assigned (A → Z)',
    sort_by: 'assigned_employee_name',
    sort_order: 'asc',
  },
  {
    value: 'assigned_employee_name:desc',
    label: 'Assigned (Z → A)',
    sort_by: 'assigned_employee_name',
    sort_order: 'desc',
  },
]

const DEFAULT_VALUE = 'created_at:desc'

export function sortOptionValue(
  sort_by: CustomerSortField | undefined,
  sort_order: SortOrder | undefined,
): string {
  if (!sort_by) return DEFAULT_VALUE
  const candidate = `${sort_by}:${sort_order ?? 'desc'}`
  return SORT_OPTIONS.some((o) => o.value === candidate) ? candidate : DEFAULT_VALUE
}

interface SortSelectProps {
  sort_by: CustomerSortField | undefined
  sort_order: SortOrder | undefined
  onChange: (next: { sort_by: CustomerSortField; sort_order: SortOrder }) => void
}

export function SortSelect({ sort_by, sort_order, onChange }: SortSelectProps) {
  const value = sortOptionValue(sort_by, sort_order)
  const handleChange = (e: SelectChangeEvent<string>) => {
    const picked = SORT_OPTIONS.find((o) => o.value === e.target.value)
    if (picked) onChange({ sort_by: picked.sort_by, sort_order: picked.sort_order })
  }
  return (
    <Select
      size="small"
      value={value}
      onChange={handleChange}
      startAdornment={
        <SortIcon
          fontSize="small"
          sx={{ mr: 1, color: 'text.secondary', flexShrink: 0 }}
        />
      }
      aria-label="Sort by"
      sx={{ minWidth: 180 }}
    >
      {SORT_OPTIONS.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  )
}
