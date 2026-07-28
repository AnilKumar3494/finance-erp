import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'

export interface PasswordRevealProps {
  shown: boolean
  onToggle: () => void
}

/**
 * Show/hide toggle for a password field. Pass as an `Input` end adornment and
 * drive the field's own `type` from the same state:
 *
 *   type={shown ? 'text' : 'password'}
 *   slotProps={{ input: { endAdornment: <PasswordReveal shown={shown} onToggle={...} /> } }}
 */
export function PasswordReveal({ shown, onToggle }: PasswordRevealProps) {
  return (
    <InputAdornment position="end">
      <IconButton
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={onToggle}
        edge="end"
        size="small"
      >
        {shown ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
      </IconButton>
    </InputAdornment>
  )
}
