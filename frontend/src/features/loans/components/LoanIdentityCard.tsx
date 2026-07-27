import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { Card } from '@/components/primitives'
import { loanDisplayId } from '../loanIdentity'
import { LoanStatusChip } from './LoanStatusChip'
import { EmiDueChip } from './EmiDueChip'
import { PrintStatementButton } from './PrintStatementButton'

interface LoanIdentityCardProps {
  loan: LoanResponse
  // Small uppercase label above the id — names the screen the card heads.
  eyebrow: string
  // Show the internal LMS number under the HP number.
  showLmsNumber?: boolean
  // Makes the status chip clickable (used to jump to loan actions).
  onStatusClick?: () => void
}

// The loan's identity band: id, customer, status chips and Print Customer
// Statement. It pins under the app top bar so the statement stays one click
// away no matter how far down the page you are — which is why the header's
// stats live in a separate card below rather than in here. Pinning those too
// would eat half the viewport on the collections cockpit.
export function LoanIdentityCard({
  loan,
  eyebrow,
  showLmsNumber,
  onStatusClick,
}: LoanIdentityCardProps) {
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
        py: 2,
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1.5, sm: 2 }}
        sx={{
          alignItems: { xs: 'stretch', sm: 'flex-start' },
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            {eyebrow}
          </Typography>
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: 20, sm: 24 }, fontFamily: 'var(--font-mono)' }}
          >
            {loanDisplayId(loan)}
          </Typography>
          {showLmsNumber && loan.hp_number && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: 'var(--font-mono)' }}
            >
              LMS: {loan.loan_number}
            </Typography>
          )}
          {loan.customer?.full_name && (
            <Box sx={{ mt: 0.75 }}>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  Name:{' '}
                </Box>
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {loan.customer.full_name}
                </Box>
              </Typography>
              {loan.customer.mobile_number && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Phone Number:{' '}
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {loan.customer.mobile_number}
                  </Box>
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <Stack
          direction={{ xs: 'row', sm: 'column' }}
          spacing={{ xs: 1, sm: 0.5 }}
          sx={{
            flexShrink: 0,
            flexWrap: 'wrap',
            rowGap: { xs: 1, sm: 0.5 },
            alignItems: { xs: 'flex-start', sm: 'flex-end' },
            '& .MuiChip-root': { minWidth: { xs: 'auto', sm: 220 }, justifyContent: 'center' },
          }}
        >
          <LoanStatusChip
            status={loan.status}
            size="medium"
            onClick={onStatusClick}
            title={onStatusClick ? 'Go to loan actions' : undefined}
          />
          <EmiDueChip status={loan.emi_due_status} size="medium" />
          {loan.status !== 'DRAFT' && <PrintStatementButton loan={loan} />}
        </Stack>
      </Stack>
    </Card>
  )
}
