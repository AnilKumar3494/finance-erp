import Box from '@mui/material/Box'

import { docScoreBand } from '../docScoreMeta'

export interface DocScoreBarProps {
  /** 0-100. Values outside the range are clamped. */
  value: number
  height?: number
  /** Colour band. Defaults to the band implied by `value`; pass to keep a
   *  per-category bar in the overall file's colour instead of its own. */
  fillVar?: string
  label?: string
}

// A token-only progress bar. Rendered with spans rather than divs so it stays
// valid HTML inside CollapsibleCard's `subtitle`, which wraps its children in a
// <Typography> (a <p>).
export function DocScoreBar({ value, height = 8, fillVar, label }: DocScoreBarProps) {
  const pct = Math.max(0, Math.min(100, value))
  const fill = fillVar ?? docScoreBand(pct).fillVar

  return (
    <Box
      component="span"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Documentation completeness'}
      sx={{
        display: 'block',
        width: '100%',
        height,
        bgcolor: 'var(--surface-alt)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'block',
          width: `${pct}%`,
          height: '100%',
          bgcolor: fill,
          borderRadius: 'var(--radius-pill)',
          // --t-fill exists in tokens.css named for exactly this and is
          // otherwise unused.
          transition: 'width var(--t-fill)',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />
    </Box>
  )
}
