import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { Card } from '@/components/primitives'
import { loanDisplayId } from '../loanIdentity'
import { LoanStatusChip } from './LoanStatusChip'
import { PrintStatementButton } from './PrintStatementButton'

interface LoanIdentityCardProps {
  loan: LoanResponse
  // Small uppercase label above the id — names the screen the card heads.
  // Retained for API compatibility; the compact band no longer renders it.
  eyebrow: string
  // Retained for API compatibility; the compact band no longer renders it.
  showLmsNumber?: boolean
  // When set, a clickable status chip is shown to jump to loan actions. Used
  // by the collections cockpit for statuses that carry a pending decision.
  onStatusClick?: () => void
}

// The loan's identity band, trimmed to one line — HP number | customer name —
// with the Print Customer Statement action alongside. It pins under the app
// top bar so the statement stays one click away no matter how far down the
// page you are; keeping it to a single line stops it eating the viewport while
// scrolled. The header's stats live in a separate card below. The collections
// cockpit additionally surfaces a clickable status chip (via `onStatusClick`)
// when the status carries a pending decision.
export function LoanIdentityCard({ loan, onStatusClick }: LoanIdentityCardProps) {
  return (
    <Card
      sx={{
        position: 'sticky',
        top: { xs: 'var(--topbar-h-mobile)', md: 'var(--topbar-h)' },
        // Under the top bar, above the page content sliding beneath it.
        zIndex: (t) => t.zIndex.appBar - 1,
        // Paper is translucent in dark mode, so restate the opaque surface
        // stack the top bar uses — otherwise scrolled content shows through.
        bgcolor: 'var(--bg)',
        backgroundImage: 'linear-gradient(var(--surface), var(--surface))',
        py: 1.25,
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Box
          sx={{
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.25,
          }}
        >
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: 18, sm: 22 }, fontFamily: 'var(--font-mono)' }}
          >
            {loanDisplayId(loan)}
          </Typography>
          {loan.customer?.full_name && (
            <>
              <Box component="span" sx={{ color: 'text.disabled' }} aria-hidden>
                |
              </Box>
              <Typography variant="h3" sx={{ fontSize: { xs: 15, sm: 18 }, fontWeight: 600 }} noWrap>
                {loan.customer.full_name}
              </Typography>
            </>
          )}
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexShrink: 0, alignItems: 'center' }}
        >
          {onStatusClick && (
            <LoanStatusChip
              status={loan.status}
              onClick={onStatusClick}
              title="Go to loan actions"
            />
          )}
          {loan.status !== 'DRAFT' && <PrintStatementButton loan={loan} />}
        </Stack>
      </Stack>
    </Card>
  )
}
