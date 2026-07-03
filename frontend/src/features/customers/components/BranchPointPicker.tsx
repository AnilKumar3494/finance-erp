import { useState } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'

import { BRANCH_POINTS } from '@/api/queries/customers'
import { Input } from '@/components/primitives'

// Sentinel value for the "add a new branch point" menu entry. Not a real
// branch name — selecting it flips the control into free-text entry mode.
const OTHER = '__other__'

interface BranchPointPickerProps {
  value: string
  onChange: (value: string) => void
  id?: string
  label?: string
  error?: string
  disabled?: boolean
}

/**
 * Branch-point selector: a dropdown of the known branch sub-offices plus a
 * "None" option and an "Other — add new…" option that reveals a text input so
 * staff can create a branch point that isn't in the list yet. An off-list value
 * passed in (e.g. a legacy/custom branch) opens directly in text-entry mode so
 * it is never silently dropped.
 */
export function BranchPointPicker({
  value,
  onChange,
  id = 'branch_point',
  label = 'Branch point',
  error,
  disabled,
}: BranchPointPickerProps) {
  const isKnown = (BRANCH_POINTS as readonly string[]).includes(value)
  const [otherMode, setOtherMode] = useState(value !== '' && !isKnown)

  if (otherMode) {
    return (
      <Box>
        <Input
          id={id}
          label={label}
          placeholder="Enter new branch point name"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          disabled={disabled}
          error={error}
        />
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => {
            setOtherMode(false)
            onChange('')
          }}
          sx={{ mt: 0.75, display: 'inline-block' }}
        >
          ‹ Choose from the list instead
        </Link>
      </Box>
    )
  }

  return (
    <Input
      select
      id={id}
      label={label}
      value={value}
      disabled={disabled}
      error={error}
      onChange={(e) => {
        const next = e.target.value
        if (next === OTHER) {
          setOtherMode(true)
          onChange('')
        } else {
          onChange(next)
        }
      }}
    >
      <MenuItem value="">
        <em>None</em>
      </MenuItem>
      {BRANCH_POINTS.map((bp) => (
        <MenuItem key={bp} value={bp}>
          {bp}
        </MenuItem>
      ))}
      <MenuItem value={OTHER}>+ Other — add new…</MenuItem>
    </Input>
  )
}
