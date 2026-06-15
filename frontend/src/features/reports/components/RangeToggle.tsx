import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'

// Shared 3M / 6M / 12M range selector for the trend charts (dashboard +
// reports). Default range is 3 months; callers own the state.
export const RANGE_MONTHS = [3, 6, 12] as const

export function RangeToggle({
  value,
  onChange,
}: {
  value: number
  onChange: (months: number) => void
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, v: number | null) => {
        if (v != null) onChange(v)
      }}
    >
      {RANGE_MONTHS.map((m) => (
        <ToggleButton key={m} value={m}>
          {m}M
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
