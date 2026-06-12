import TableCell from '@mui/material/TableCell'
import TableSortLabel from '@mui/material/TableSortLabel'
import type { SxProps, Theme } from '@mui/material/styles'

import type { SortOrder } from './useTableSort'

// MUI hides the sort arrow on inactive columns and only fades it in on hover,
// which hides the "sortable" affordance. Pin it at reduced opacity so every
// sortable header advertises itself; the active column gets full opacity.
const sortLabelSx = {
  '& .MuiTableSortLabel-icon': { opacity: 0.4 },
  '&.Mui-active .MuiTableSortLabel-icon': { opacity: 1 },
} as const

// A sortable table header cell. Wraps the active/direction/sortDirection wiring
// so every table's <TableHead> stays declarative. `onSort` receives the clicked
// field + its default direction (feed straight into toggleSort).
export function SortableTh<F extends string>({
  field,
  label,
  activeField,
  activeOrder,
  defaultDir = 'asc',
  onSort,
  align,
  sx,
}: {
  field: F
  label: React.ReactNode
  activeField: F
  activeOrder: SortOrder
  defaultDir?: SortOrder
  onSort: (field: F, defaultDir: SortOrder) => void
  align?: 'left' | 'right' | 'center'
  sx?: SxProps<Theme>
}) {
  const active = activeField === field
  return (
    <TableCell
      align={align}
      sortDirection={active ? activeOrder : false}
      sx={{ fontWeight: 600, ...sx }}
    >
      <TableSortLabel
        active={active}
        direction={active ? activeOrder : defaultDir}
        onClick={() => onSort(field, defaultDir)}
        sx={sortLabelSx}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )
}
