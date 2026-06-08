import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'

// A single headline statistic. `accent` tints the value (e.g. error.main for
// outstanding / bad-debt figures) so the dashboard reads at a glance.
export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: string
}) {
  return (
    <Card sx={{ p: 2, height: '100%' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ mt: 0.5, color: accent, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {hint}
        </Typography>
      )}
    </Card>
  )
}

// Responsive grid container for KPI cards — auto-fits as many columns as fit.
export const KPI_GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: {
    xs: 'repeat(2, 1fr)',
    sm: 'repeat(3, 1fr)',
    md: 'repeat(4, 1fr)',
  },
} as const
