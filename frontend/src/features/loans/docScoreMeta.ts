import type { ChipProps } from '@mui/material/Chip'

// Presentation for a documentation-completeness score, mirroring the
// LOAN_STATUS_META pattern. `fillVar` is a raw token for `bgcolor` on the bar;
// `textColor` is the MUI palette key for text. Both idioms are in active use —
// note the token is `--danger` while the palette key is `error` (mui-theme.ts
// bridges them).
export interface DocScoreBand {
  key: 'strong' | 'adequate' | 'thin'
  label: string
  chipColor: NonNullable<ChipProps['color']>
  fillVar: string
  textColor: string
}

const STRONG: DocScoreBand = {
  key: 'strong',
  label: 'Strong file',
  chipColor: 'success',
  fillVar: 'var(--success)',
  textColor: 'success.main',
}

const ADEQUATE: DocScoreBand = {
  key: 'adequate',
  label: 'Adequate',
  chipColor: 'warning',
  fillVar: 'var(--warning)',
  textColor: 'warning.main',
}

const THIN: DocScoreBand = {
  key: 'thin',
  label: 'Thin file',
  chipColor: 'error',
  fillVar: 'var(--danger)',
  textColor: 'error.main',
}

export function docScoreBand(score: number): DocScoreBand {
  if (score >= 85) return STRONG
  if (score >= 60) return ADEQUATE
  return THIN
}
