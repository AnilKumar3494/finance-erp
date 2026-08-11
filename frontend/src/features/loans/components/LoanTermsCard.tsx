import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/AddOutlined'

import { Btn, Card } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import type { LoanResponse } from '@/api/queries/loans'
import type { LoanTransactionSummary } from '@/api/queries/transactions'
import type { DueCycleResponse } from '@/api/queries/dueCycles'
import type { CycleNetDue } from '../cycleNetDue'

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
  // The cycle to act on first (lowest-numbered still owing, net of carried
  // credit). Drives the Next EMI figure and the Focus cycle block.
  focusCycle?: DueCycleResponse | null
  focusNet?: CycleNetDue
  penaltiesTotal?: number
  pendingCount?: number
  pendingTotal?: string | number
  // Whether to render the live-balances row. Off for drafts (no schedule).
  showMoney?: boolean
  // Record-payment button — shown when the loan is collectible.
  onRecord?: () => void
  showRecord?: boolean
  // Extra content appended inside the card.
  children?: ReactNode
}

/**
 * The loan's contract terms, live balances, and current focus cycle as one
 * card. Shared by the Finance detail page and the Collections workspace so both
 * show the same figures, layout, and Record-payment entry point.
 */
export function LoanTermsCard({
  loan,
  summary,
  focusCycle,
  focusNet,
  penaltiesTotal = 0,
  pendingCount = 0,
  pendingTotal = '0',
  showMoney = true,
  onRecord,
  showRecord = false,
  children,
}: LoanTermsCardProps) {
  const nominalEmi =
    loan.total_payable != null && loan.tenure ? Number(loan.total_payable) / loan.tenure : null
  // The actual amount due on the next collectible cycle (base EMI + any penalty
  // add-on), not the sticker EMI — falling back to the nominal instalment.
  const emiValue = focusCycle
    ? fmtINR(Number(focusCycle.total_due))
    : nominalEmi != null
      ? fmtINR(nominalEmi)
      : '—'
  const emiHint = focusCycle
    ? Number(focusCycle.addon_from_penalties) > 0
      ? `due ${fmtDate(focusCycle.due_date)} · ${fmtINR(Number(focusCycle.base_emi))} + ${fmtINR(Number(focusCycle.addon_from_penalties))} penalty`
      : `due ${fmtDate(focusCycle.due_date)}`
    : undefined

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
            <HeaderStat label="Next EMI" value={emiValue} hint={emiHint} />
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

        {focusCycle && (
          <>
            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">
                Focus cycle — #{focusCycle.cycle_number} · due {fmtDate(focusCycle.due_date)}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                  gap: { xs: 1.5, sm: 2.5 },
                  mt: 0.5,
                }}
              >
                <HeaderStat
                  label="Net due"
                  value={focusNet ? fmtINR(focusNet.netDue) : '—'}
                  tone={focusNet && focusNet.netDue > 0 ? 'warning' : undefined}
                />
                <HeaderStat label="Scheduled due" value={fmtINR(Number(focusCycle.total_due))} />
                <HeaderStat label="Received" value={fmtINR(Number(focusCycle.total_received))} />
                <HeaderStat
                  label="Penalty"
                  value={
                    Number(focusCycle.penalty_amount) > 0
                      ? fmtINR(Number(focusCycle.penalty_amount))
                      : '—'
                  }
                />
              </Box>
            </Box>
          </>
        )}

        {showRecord && onRecord && (
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
            <Btn variant="primary" size="md" startIcon={<AddIcon />} onClick={onRecord}>
              Record payment
            </Btn>
          </Stack>
        )}

        {children}
      </Stack>
    </Card>
  )
}
