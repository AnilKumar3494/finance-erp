import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

export interface BarDatum {
  label: string
  value: number
}

// Dependency-free vertical bar chart. Bars scale to the series max and grow
// from a shared baseline so the x-axis labels stay aligned. Hover shows the
// exact value. Used for monthly trends / collection series.
export function MiniBarChart({
  data,
  formatValue,
  barColor = 'primary.main',
  height = 200,
}: {
  data: BarDatum[]
  formatValue?: (n: number) => string
  barColor?: string
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No data for this period.
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, height, alignItems: 'stretch', overflowX: 'auto' }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100
        const display = formatValue ? formatValue(d.value) : String(d.value)
        return (
          <Box
            key={`${d.label}-${i}`}
            sx={{
              flex: '1 0 auto',
              minWidth: 34,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Box sx={{ flexGrow: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <Tooltip title={`${d.label}: ${display}`} arrow>
                <Box
                  sx={{
                    width: '62%',
                    mx: 'auto',
                    height: `${pct}%`,
                    minHeight: d.value > 0 ? 3 : 0,
                    bgcolor: barColor,
                    borderRadius: '4px 4px 0 0',
                    transition: 'opacity var(--t-fast)',
                    '&:hover': { opacity: 0.8 },
                  }}
                />
              </Tooltip>
            </Box>
            <Typography
              variant="caption"
              sx={{ mt: 0.75, fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}
            >
              {d.label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}
