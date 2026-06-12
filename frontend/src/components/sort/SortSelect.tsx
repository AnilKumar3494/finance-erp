import MenuItem from '@mui/material/MenuItem'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import type { SxProps, Theme } from '@mui/material/styles'
import SortIcon from '@mui/icons-material/SortOutlined'

import type { SortOrder } from './useTableSort'

// One option per state the column headers can produce, so the dropdown always
// faithfully reflects the active sort — there's no header-click combination
// that lands in a state the Select can't label. This is the primary sort
// control on small screens where the table headers are replaced by cards.
export interface SortOption<F extends string = string> {
  value: string
  label: string
  sort_by: F
  sort_order: SortOrder
}

// Resolve the current sort to one of the option values, falling back to the
// first option when the active sort isn't representable (e.g. no sort set).
export function sortOptionValue<F extends string>(
  options: readonly SortOption<F>[],
  sort_by: F | undefined,
  sort_order: SortOrder | undefined,
): string {
  const fallback = options[0]?.value ?? ''
  if (!sort_by) return fallback
  const candidate = `${sort_by}:${sort_order ?? 'desc'}`
  return options.some((o) => o.value === candidate) ? candidate : fallback
}

// Generic mobile sort dropdown shared by every sortable table. Each table
// passes its own option set; the field type stays generic.
export function SortSelect<F extends string>({
  options,
  sort_by,
  sort_order,
  onChange,
  sx,
}: {
  options: readonly SortOption<F>[]
  sort_by: F | undefined
  sort_order: SortOrder | undefined
  onChange: (next: { sort_by: F; sort_order: SortOrder }) => void
  sx?: SxProps<Theme>
}) {
  const value = sortOptionValue(options, sort_by, sort_order)
  const handleChange = (e: SelectChangeEvent<string>) => {
    const picked = options.find((o) => o.value === e.target.value)
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
      sx={{ minWidth: { xs: 0, sm: 180 }, width: { xs: '100%', sm: 'auto' }, ...sx }}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  )
}
