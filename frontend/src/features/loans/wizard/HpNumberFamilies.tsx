import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useHpNumberFamilies } from '@/api/queries/loans'
import { Btn } from '@/components/primitives'

// How many families to show before the "older series" fold. The list comes
// back most-recently-used first, so the top ones are the live sequences.
const VISIBLE = 6

// A read-only helper under the HP-number field: the latest few numbers in each
// prefix series, highest first, so whoever is assigning a new HP number can see
// where each sequence stands and continue it.
export function HpNumberFamilies() {
  const { data, isLoading, isError } = useHpNumberFamilies()
  const [showAll, setShowAll] = useState(false)

  // Silent helper — never block or shout if it can't load.
  if (isLoading || isError || !data || data.length === 0) return null

  const shown = showAll ? data : data.slice(0, VISIBLE)
  const hidden = data.length - shown.length

  return (
    <Box
      sx={{
        mt: 1,
        p: 1.5,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Recent HP numbers by series — the latest is shown first, so continue the sequence.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
          gap: 1,
        }}
      >
        {shown.map((fam) => (
          <FamilyCard key={fam.prefix} prefix={fam.prefix} recent={fam.recent} />
        ))}
      </Box>
      {(hidden > 0 || showAll) && (
        <Box sx={{ mt: 1 }}>
          <Btn variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show fewer' : `Show older series (${hidden})`}
          </Btn>
        </Box>
      )}
    </Box>
  )
}

function FamilyCard({ prefix, recent }: { prefix: string; recent: string[] }) {
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, letterSpacing: 0.4, color: 'text.secondary' }}
      >
        {prefix}
      </Typography>
      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        {recent.map((hp, i) => (
          <Typography
            key={hp}
            variant="body2"
            sx={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: i === 0 ? 600 : 400,
              color: i === 0 ? 'text.primary' : 'text.secondary',
            }}
          >
            {hp}
          </Typography>
        ))}
      </Stack>
    </Box>
  )
}
