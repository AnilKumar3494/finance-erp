import MenuItem from '@mui/material/MenuItem'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import SortIcon from '@mui/icons-material/SortOutlined'

import type { LoanSortField, SortOrder } from '@/api/queries/loans'

export interface SortOption {
  value: string
  label: string
  sort_by: LoanSortField
  sort_order: SortOrder
}

// One option per state the column headers can produce, so the Select always
// faithfully reflects the URL — there's no header-click combination that lands
// in a state the dropdown can't label. This is the primary sort control on
// small screens where the table headers are replaced by cards.
export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'created_at:desc', label: 'Newest first', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest first', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'full_name:asc', label: 'Name (A → Z)', sort_by: 'full_name', sort_order: 'asc' },
  { value: 'full_name:desc', label: 'Name (Z → A)', sort_by: 'full_name', sort_order: 'desc' },
  {
    value: 'mandal_village:asc',
    label: 'Mandal/Village (A → Z)',
    sort_by: 'mandal_village',
    sort_order: 'asc',
  },
  {
    value: 'mandal_village:desc',
    label: 'Mandal/Village (Z → A)',
    sort_by: 'mandal_village',
    sort_order: 'desc',
  },
  { value: 'status:asc', label: 'Status (A → Z)', sort_by: 'status', sort_order: 'asc' },
  { value: 'status:desc', label: 'Status (Z → A)', sort_by: 'status', sort_order: 'desc' },
]

const DEFAULT_VALUE = 'created_at:desc'

export function sortOptionValue(
  sort_by: LoanSortField | undefined,
  sort_order: SortOrder | undefined,
): string {
  if (!sort_by) return DEFAULT_VALUE
  const candidate = `${sort_by}:${sort_order ?? 'desc'}`
  return SORT_OPTIONS.some((o) => o.value === candidate) ? candidate : DEFAULT_VALUE
}

interface SortSelectProps {
  sort_by: LoanSortField | undefined
  sort_order: SortOrder | undefined
  onChange: (next: { sort_by: LoanSortField; sort_order: SortOrder }) => void
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
        <SortIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary', flexShrink: 0 }} />
      }
      aria-label="Sort by"
      sx={{ minWidth: { xs: 0, sm: 180 }, width: { xs: '100%', sm: 'auto' } }}
    >
      {SORT_OPTIONS.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  )
}
