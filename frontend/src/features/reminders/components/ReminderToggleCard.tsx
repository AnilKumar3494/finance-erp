import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'

interface ReminderToggleCardProps {
  enabled: boolean
  pending: boolean
  onChange: (enabled: boolean) => void
  /** Short line describing what is muted when off. */
  description: string
}

/**
 * Presentational WhatsApp-reminder toggle. The owning page wires it to the
 * customer / loan toggle mutation. Admin-gating is the page's responsibility.
 */
export function ReminderToggleCard({
  enabled,
  pending,
  onChange,
  description,
}: ReminderToggleCardProps) {
  return (
    <Card>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h3" sx={{ fontSize: 15, fontWeight: 600 }}>
            WhatsApp reminders
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        </Box>
        <Switch
          checked={enabled}
          disabled={pending}
          onChange={(e) => onChange(e.target.checked)}
          slotProps={{ input: { 'aria-label': 'Toggle WhatsApp reminders' } }}
        />
      </Stack>
    </Card>
  )
}
