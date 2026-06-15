import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

export interface BarDatum {
  label: string
  value: number
}

// Roughly the width (px) one x-axis label needs before neighbours collide.
// Labels are thinned to honour this so a 30/90/365-bar series stays readable
// on a phone instead of smearing every label together.
const LABEL_MIN_PX = 40

// Dependency-free vertical bar chart. Bars share the available width and grow
// from a shared baseline so the x-axis labels stay aligned. Hover (or tap)
// shows the exact value. Used for monthly trends / collection series.
//
// Responsive: bars flex-shrink to fit the container down to a small floor, so
// the common monthly charts fit a phone without a horizontal scroll; genuinely
// dense daily series still scroll. X-axis labels are thinned to the measured
// width so they never overlap.
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
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setTrackWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = Math.max(1, ...data.map((d) => d.value))

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No data for this period.
      </Typography>
    )
  }

  // Show a label every `labelStep` bars so at most ~(width / LABEL_MIN_PX) are
  // visible. Counted from the end so the most recent period is always named.
  // trackWidth === 0 on first paint → show every label until measured.
  const maxLabels = trackWidth > 0 ? Math.max(2, Math.floor(trackWidth / LABEL_MIN_PX)) : data.length
  const labelStep = Math.max(1, Math.ceil(data.length / maxLabels))
  const showLabel = (i: number) => (data.length - 1 - i) % labelStep === 0

  return (
    <Box
      ref={trackRef}
      sx={{
        display: 'flex',
        gap: { xs: '3px', sm: 1 },
        height,
        alignItems: 'stretch',
        overflowX: 'auto',
      }}
    >
      {data.map((d, i) => {
        const pct = (d.value / max) * 100
        const display = formatValue ? formatValue(d.value) : String(d.value)
        return (
          <Box
            key={`${d.label}-${i}`}
            sx={{
              flex: '1 1 0',
              minWidth: { xs: 10, sm: 22 },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Box sx={{ flexGrow: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <Tooltip title={`${d.label}: ${display}`} arrow enterTouchDelay={0}>
                <Box
                  sx={{
                    width: '70%',
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
              aria-hidden={!showLabel(i)}
              sx={{
                mt: 0.75,
                fontSize: 10,
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                height: 14,
                lineHeight: '14px',
                overflow: 'hidden',
              }}
            >
              {showLabel(i) ? d.label : ''}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}
