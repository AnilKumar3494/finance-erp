import MenuItem from '@mui/material/MenuItem'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'

import { useEmployees } from '@/api/queries/employees'

const ANYONE = ''

// "Assigned to" list filter — narrows a list to one employee's assigned
// customers. Backed by GET /auth/employees, which is admin-gated, so only
// render this for ADMIN/SUPER_ADMIN (employees are server-scoped to
// themselves anyway).
export function AssignedToSelect({
  value,
  onChange,
  sx,
}: {
  value: string | undefined
  onChange: (next: string | undefined) => void
  sx?: SxProps<Theme>
}) {
  const query = useEmployees({ page_size: 100 })
  const options = query.data?.results ?? []

  // Until the roster loads, a value from the URL has no matching MenuItem;
  // fall back to "anyone" so the Select never holds an out-of-range value.
  const known = !!value && options.some((o) => o.id === value)
  const handleChange = (e: SelectChangeEvent<string>) =>
    onChange(e.target.value === ANYONE ? undefined : e.target.value)

  return (
    <Select
      size="small"
      value={known ? value : ANYONE}
      onChange={handleChange}
      displayEmpty
      startAdornment={
        <PersonOutlineIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary', flexShrink: 0 }} />
      }
      renderValue={(v) => {
        const picked = options.find((o) => o.id === v)
        return picked
          ? `Assigned to: ${picked.full_name?.trim() || picked.username}`
          : 'Assigned to: anyone'
      }}
      aria-label="Filter by assigned employee"
      sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', sm: 'auto' }, ...sx }}
    >
      <MenuItem value={ANYONE}>Anyone</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          <div>
            <Typography variant="body2">{o.full_name?.trim() || o.username}</Typography>
            <Typography variant="caption" color="text.secondary">
              @{o.username}
            </Typography>
          </div>
        </MenuItem>
      ))}
    </Select>
  )
}
