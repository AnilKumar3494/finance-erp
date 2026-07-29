import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { Spinner } from '@/components/primitives'
import { docScoreBand } from '../docScoreMeta'
import { useDocCompleteness } from '../useDocCompleteness'
import { DocScoreBar } from './DocScoreBar'

// The caveat is fixed copy, not a prop. The score counts files; it cannot say
// anything about whether they are genuine, legible or current, and without this
// line a number out of 100 gets read as a creditworthiness score.
export const DOC_SCORE_CAVEAT = 'Counts documents on file. It does not verify their contents.'

// Compact score block for the approval dialog and the wizard. Renders its own
// loading state so it never gates the surface it sits in.
export function DocScoreSummary({
  loan,
  maxGaps = 3,
}: {
  loan: LoanResponse
  maxGaps?: number
}) {
  const { data, isLoading, isError } = useDocCompleteness(loan)

  if (isLoading) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 1 }}>
        <Spinner size={18} />
        <Typography variant="body2" color="text.secondary">
          Checking documentation…
        </Typography>
      </Stack>
    )
  }

  if (isError || !data) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        Documentation score unavailable.
      </Typography>
    )
  }

  const band = docScoreBand(data.score)
  // Categories that cannot score yet (no vehicle, no guarantor) explain an
  // apparently low total — especially in the wizard, where the first steps
  // legitimately cap at 60.
  const notes = data.categories.filter((c) => c.note && c.points === 0).map((c) => c.note)
  const gaps = data.missing.slice(0, maxGaps)

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', mb: 0.75 }}>
        <Typography variant="h3" sx={{ color: band.textColor }}>
          {data.score}
          <Typography component="span" variant="body2" color="text.secondary">
            {' '}
            / 100
          </Typography>
        </Typography>
        <Chip size="small" color={band.chipColor} label={band.label} />
      </Stack>

      <DocScoreBar value={data.score} fillVar={band.fillVar} />

      {notes.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {notes.join(' · ')}
        </Typography>
      )}

      {gaps.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Missing: {gaps.map((g) => g.label).join(', ')}
          {data.missing.length > gaps.length && ` +${data.missing.length - gaps.length} more`}
        </Typography>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {DOC_SCORE_CAVEAT}
      </Typography>
    </Box>
  )
}
