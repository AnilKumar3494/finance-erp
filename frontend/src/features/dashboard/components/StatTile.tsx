import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'

export interface StatTileProps {
  label: string
  value: string
  hint?: string
  accent?: string
  // When provided the whole tile becomes an accessible button (ButtonBase
  // handles focus + keyboard) that deep-links the stat to its underlying list.
  onClick?: () => void
}

const cardSx = {
  p: 2,
  height: '100%',
  bgcolor: 'background.paper',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 'var(--radius-md)',
} as const

export function StatTile({ label, value, hint, accent, onClick }: StatTileProps) {
  const body = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {onClick && <ChevronRightOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />}
      </Box>
      <Typography variant="h3" sx={{ mt: 0.5, color: accent, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {hint}
        </Typography>
      )}
    </>
  )

  if (!onClick) {
    return <Box sx={cardSx}>{body}</Box>
  }
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        ...cardSx,
        display: 'block',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
        '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
      }}
    >
      {body}
    </ButtonBase>
  )
}
