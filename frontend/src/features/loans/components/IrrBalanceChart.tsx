import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'

import { fmtINRApprox } from '@/lib/format'
import type { AmortRow } from '../irrMath'
import { avgOutstanding } from '../irrMath'

// The picture that explains why a flat rate is worth roughly double.
//
// Interest is charged on the full principal for the whole tenure (the solid line
// across the top), but the customer repays as they go, so what they actually owe
// falls every month (the bars). The gap between the two is money already repaid
// but still being charged for. Averaged over the life they owe only about half
// the principal — hence a ~2x rate.
//
// Hand-rolled SVG on purpose: the project has no charting library, this is a row
// of rectangles, and keeping it as plain markup means the printable statement can
// embed the very same shape (see amortSchedulePrint.ts) instead of redrawing it.

export interface IrrBalanceChartProps {
  rows: AmortRow[]
  principal: number
  /** Render at print size with black-on-white colours instead of theme colours. */
  print?: boolean
}

const W = 480
const H = 180
const PAD_L = 58
const PAD_R = 10
const PAD_T = 14
const PAD_B = 26

export function IrrBalanceChart({ rows, principal, print = false }: IrrBalanceChartProps) {
  const theme = useTheme()
  if (rows.length === 0 || principal <= 0) return null

  const avg = avgOutstanding(rows)
  if (avg === null) return null

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  // Everything is scaled against the principal — the chart's whole point is the
  // gap between it and the bars, so the top of the axis is always the principal.
  const y = (value: number) => PAD_T + plotH * (1 - value / principal)
  const slot = plotW / rows.length
  const barW = Math.max(2, slot * 0.72)

  const barFill = print ? '#555' : theme.palette.primary.main
  const chargedColor = print ? '#000' : theme.palette.text.primary
  const avgColor = print ? '#000' : theme.palette.warning.dark
  const axisColor = print ? '#999' : theme.palette.divider
  const labelColor = print ? '#333' : theme.palette.text.secondary

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      role="img"
      aria-label={`Outstanding balance falls from ${fmtINRApprox(principal)} to zero over ${rows.length} months, averaging ${fmtINRApprox(avg)}`}
      style={{ display: 'block', maxWidth: W, overflow: 'visible' }}
    >
      {/* Shaded gap: charged on the full principal, but this much is already repaid. */}
      <rect
        x={PAD_L}
        y={PAD_T}
        width={plotW}
        height={plotH}
        fill={barFill}
        opacity={print ? 0.06 : 0.08}
      />

      {/* Baseline. */}
      <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke={axisColor} strokeWidth={1} />

      {/* Outstanding balance after each EMI. */}
      {rows.map((r, i) => {
        const h = Math.max(0, y(0) - y(r.balance))
        return (
          <rect
            key={r.n}
            x={PAD_L + i * slot + (slot - barW) / 2}
            y={y(r.balance)}
            width={barW}
            height={h}
            fill={barFill}
            opacity={print ? 0.85 : 0.9}
            rx={1}
          />
        )
      })}

      {/* "Interest is charged on this" — the full principal, all tenure. */}
      <line
        x1={PAD_L}
        y1={y(principal)}
        x2={W - PAD_R}
        y2={y(principal)}
        stroke={chargedColor}
        strokeWidth={1.5}
      />
      <text x={PAD_L - 6} y={y(principal) + 4} textAnchor="end" fontSize={10} fill={labelColor}>
        {fmtINRApprox(principal)}
      </text>

      {/* Average actually owed — the number that explains the multiple. */}
      <line
        x1={PAD_L}
        y1={y(avg)}
        x2={W - PAD_R}
        y2={y(avg)}
        stroke={avgColor}
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={PAD_L - 6} y={y(avg) + 4} textAnchor="end" fontSize={10} fill={avgColor}>
        {fmtINRApprox(avg)}
      </text>

      <text x={PAD_L - 6} y={y(0) + 4} textAnchor="end" fontSize={10} fill={labelColor}>
        0
      </text>

      {/* Only the first and last month are labelled — anything more is noise at
          this size, and tenures run to 36. */}
      <text x={PAD_L} y={H - 8} fontSize={10} fill={labelColor}>
        Month 1
      </text>
      <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize={10} fill={labelColor}>
        Month {rows.length}
      </text>
    </svg>
  )
}

// The chart's legend, kept next to it so the two never drift apart.
export function IrrChartLegend({ rows, principal }: { rows: AmortRow[]; principal: number }) {
  const theme = useTheme()
  const avg = avgOutstanding(rows)
  if (avg === null || principal <= 0) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 0.5 }}>
      <LegendKey
        color={theme.palette.text.primary}
        label={`Charged on ${fmtINRApprox(principal)}`}
      />
      <LegendKey color={theme.palette.primary.main} label="Actually owed" solid />
      <LegendKey
        color={theme.palette.warning.dark}
        label={`Average owed ${fmtINRApprox(avg)}`}
        dashed
      />
    </Box>
  )
}

function LegendKey({
  color,
  label,
  solid = false,
  dashed = false,
}: {
  color: string
  label: string
  solid?: boolean
  dashed?: boolean
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        sx={{
          width: 14,
          height: solid ? 10 : 0,
          borderRadius: solid ? '2px' : 0,
          bgcolor: solid ? color : 'transparent',
          borderTop: solid ? 'none' : `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}
