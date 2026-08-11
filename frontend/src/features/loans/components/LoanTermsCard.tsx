import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import type { LoanResponse } from '@/api/queries/loans'
import type { LoanTransactionSummary } from '@/api/queries/transactions'

// A single headline figure — label over value, with an optional hint line and a
// warning tint. Shared by the Finance detail and Collections workspace cards so
// they read identically.
export function HeaderStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warning'
}) {
  const color = tone === 'warning' ? 'warning.main' : undefined
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 16, sm: 18 }, color }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  )
}

interface LoanTermsCardProps {
  loan: LoanResponse
  // Live balances (Outstanding / Total paid). Omit to hide the money row — e.g.
  // a DRAFT that has no schedule yet.
  summary?: LoanTransactionSummary | null
  // Next EMI display, computed by the caller (Collections uses the focus
  // cycle's total due; the detail page uses the next UPCOMING cycle). Falls
  // back to the nominal instalment (total payable / tenure) when not given.
  nextEmi?: { value: string; hint?: string }
  penaltiesTotal?: number
  pendingCount?: number
  pendingTotal?: string | number
  // Whether to render the live-balances row. Off for drafts (no schedule).
  showMoney?: boolean
  // Extra content appended inside the card (e.g. the Collections focus cycle +
  // Record payment button).
  children?: ReactNode
}

/**
 * The loan's contract terms and (optionally) its live balances, as one card.
 * Shared by the Finance detail page and the Collections workspace so both show
 * the same figures in the same layout.
 */
export function LoanTermsCard({
  loan,
  summary,
  nextEmi,
  penaltiesTotal = 0,
  pendingCount = 0,
  pendingTotal = '0',
  showMoney = true,
  children,
}: LoanTermsCardProps) {
  const nominalEmi =
    loan.total_payable != null && loan.tenure ? Number(loan.total_payable) / loan.tenure : null
  const emiValue =
    nextEmi?.value ?? (nominalEmi != null ? fmtINR(nominalEmi) : '—')

  return (
    <Card>
      <Stack spacing={1.5}>
        {/* Loan terms — the fixed contract figures. */}
        <Box>
          <Typography variant="overline" color="text.secondary">
            Loan Terms
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
              gap: { xs: 1.5, sm: 2.5 },
              mt: 0.5,
            }}
          >
            <HeaderStat
              label="Principal"
              value={loan.principal != null ? fmtINR(Number(loan.principal)) : '—'}
            />
            <HeaderStat
              label="Interest rate"
              value={loan.interest_rate != null ? `${loan.interest_rate}% p.a.` : '—'}
            />
            <HeaderStat
              label="Tenure"
              value={loan.tenure != null ? `${loan.tenure} months` : '—'}
            />
            <HeaderStat
              label="Total payable"
              value={loan.total_payable != null ? fmtINR(Number(loan.total_payable)) : '—'}
            />
            <HeaderStat label="Next EMI" value={emiValue} hint={nextEmi?.hint} />
          </Box>
        </Box>

        {showMoney && (
          <>
            <Divider />
            {/* Money — live balances. */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                gap: { xs: 1.5, sm: 2.5 },
              }}
            >
              <HeaderStat
                label="Outstanding"
                value={summary ? fmtINR(Number(summary.outstanding)) : '—'}
              />
              <HeaderStat
                label="Total paid"
                value={summary ? fmtINR(Number(summary.total_paid)) : '—'}
              />
              <HeaderStat
                label="Penalties"
                value={penaltiesTotal > 0 ? fmtINR(penaltiesTotal) : '—'}
                tone={penaltiesTotal > 0 ? 'warning' : undefined}
              />
              <HeaderStat
                label="Pending confirmations"
                value={pendingCount > 0 ? `${pendingCount}` : '—'}
                hint={pendingCount > 0 ? fmtINR(Number(pendingTotal)) : undefined}
                tone={pendingCount > 0 ? 'warning' : undefined}
              />
            </Box>
          </>
        )}

        {children}
      </Stack>
    </Card>
  )
}
