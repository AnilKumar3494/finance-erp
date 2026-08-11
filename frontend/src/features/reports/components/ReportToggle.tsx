import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Stack from '@mui/material/Stack'
import type { ReactNode } from 'react'

// A single labelled switch for report income toggles (fee income, penalty
// income). Kept tiny and shared so the toggles read identically on the P&L,
// Balance Sheet, Fees report, and Dashboard.
export function ReportToggle({
  label,
  checked,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <FormControlLabel
      control={
        <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      }
      label={label}
      slotProps={{ typography: { variant: 'body2' } }}
      sx={{ m: 0 }}
    />
  )
}

// A row of income toggles. Render whichever switches a surface needs.
export function ReportToggleBar({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
      {children}
    </Stack>
  )
}
