import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { Spinner } from '@/components/primitives'
import type { DocScoreCategory } from '../docCompleteness'
import { docScoreBand } from '../docScoreMeta'
import { useDocCompleteness } from '../useDocCompleteness'
import { CollapsibleCard } from './CollapsibleCard'
import { DocScoreBar } from './DocScoreBar'
import { DOC_SCORE_CAVEAT } from './DocScoreSummary'

// Detail-page surface. Collapsed by default like its neighbours, with the score
// and bar in the subtitle so the number reads without expanding.
export function DocScoreCard({ loan }: { loan: LoanResponse }) {
  const { data, isLoading, isError } = useDocCompleteness(loan)
  const band = data ? docScoreBand(data.score) : null

  const subtitle =
    isLoading || isError || !data || !band ? (
      isLoading ? (
        'Checking documentation…'
      ) : (
        'Score unavailable'
      )
    ) : (
      <Box component="span" sx={{ display: 'block' }}>
        <Box component="span" sx={{ color: band.textColor, fontWeight: 700 }}>
          {data.score} / 100
        </Box>
        {' · '}
        {band.label}
        <Box component="span" sx={{ display: 'block', maxWidth: 320, mt: 0.75 }}>
          <DocScoreBar value={data.score} fillVar={band.fillVar} />
        </Box>
      </Box>
    )

  return (
    <CollapsibleCard title="Documentation Completeness" subtitle={subtitle}>
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      )}

      {isError && (
        <Typography variant="body2" color="text.secondary">
          Documentation score unavailable. Reload to try again.
        </Typography>
      )}

      {data && (
        <Stack spacing={2.5}>
          {data.categories.map((c) => (
            <CategoryRow key={c.key} category={c} />
          ))}
          <Typography variant="caption" color="text.secondary">
            {DOC_SCORE_CAVEAT} Advisory only — it does not affect approval.
          </Typography>
        </Stack>
      )}
    </CollapsibleCard>
  )
}

function CategoryRow({ category }: { category: DocScoreCategory }) {
  const pct = category.max > 0 ? (category.points / category.max) * 100 : 0
  const complete = category.points >= category.max

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {category.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {category.points} / {category.max}
        </Typography>
      </Stack>

      {/* Per-category bars take the overall band's colour rather than their own,
          so a green sliver next to a red one doesn't imply two rival verdicts. */}
      <DocScoreBar
        value={pct}
        height={6}
        fillVar={complete ? 'var(--success)' : 'var(--warning)'}
        label={category.title}
      />

      {category.note && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {category.note}
        </Typography>
      )}

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
        {category.items.map((i) => (
          <Chip
            key={i.key}
            size="small"
            variant={i.points >= i.max ? 'filled' : 'outlined'}
            color={i.points >= i.max ? 'success' : 'default'}
            label={i.points >= i.max ? i.label : `${i.label} — missing`}
          />
        ))}
      </Stack>
    </Box>
  )
}
