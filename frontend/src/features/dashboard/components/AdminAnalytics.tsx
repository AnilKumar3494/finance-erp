import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'

import {
  useCollectionReport,
  useLoanPortfolio,
  type CollectionReport,
} from '@/api/queries/reports'
import { Btn, Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from '@/features/reports/components/AsyncSection'
import { money } from '@/features/reports/reportUtils'

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'gpay', label: 'GPay' },
  { key: 'phonepe', label: 'PhonePe' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'other', label: 'Other' },
] as const

const METHOD_DAYS = 30

// Admin-only analytics block: portfolio totals and a payment-method split.
// Reuses the Reports module's data hooks.
export function AdminAnalytics() {
  const navigate = useNavigate()

  const portfolio = useLoanPortfolio()
  const methods = useCollectionReport('daily', METHOD_DAYS)

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Loan Portfolio
        </Typography>
        <AsyncSection isLoading={portfolio.isLoading} isError={portfolio.isError} error={portfolio.error}>
          {portfolio.data && (
            <Card sx={{ p: 0, overflow: 'hidden' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
                <PortfolioStat label="Principal lent" value={fmtINR(money(portfolio.data.total_principal))} />
                <PortfolioStat label="Total payable" value={fmtINR(money(portfolio.data.total_payable))} />
                <PortfolioStat
                  label="Collected"
                  value={fmtINR(money(portfolio.data.total_collected))}
                  accent="success.main"
                />
                <PortfolioStat
                  label="Outstanding"
                  value={fmtINR(money(portfolio.data.total_outstanding))}
                  accent="error.main"
                />
                <PortfolioStat label="Avg interest" value={`${portfolio.data.average_interest_rate}%`} />
                <PortfolioStat label="Avg tenure" value={`${portfolio.data.average_tenure} mo`} />
              </Box>
            </Card>
          )}
        </AsyncSection>
      </Box>

      <Box>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Payment methods · last {METHOD_DAYS} days
        </Typography>
        <Card>
          <AsyncSection isLoading={methods.isLoading} isError={methods.isError} error={methods.error}>
            {methods.data && <MethodSplit report={methods.data} />}
          </AsyncSection>
        </Card>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/reports', search: { tab: 'overview' } })}
        >
          View full reports →
        </Btn>
      </Box>
    </Stack>
  )
}

function PortfolioStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{ p: 2, borderRight: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ mt: 0.5, color: accent, fontSize: 18 }}>
        {value}
      </Typography>
    </Box>
  )
}

function MethodSplit({ report }: { report: CollectionReport }) {
  // Sum each method across the period's daily entries (the report has no
  // top-level per-method total).
  const totals = PAYMENT_METHODS.map((m) => ({
    label: m.label,
    amount: report.entries.reduce((n, e) => n + money(e[m.key]), 0),
  }))
  const grand = totals.reduce((n, t) => n + t.amount, 0)

  if (grand <= 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No collections in the last {METHOD_DAYS} days.
      </Typography>
    )
  }

  return (
    <Stack spacing={1.5}>
      {totals
        .filter((t) => t.amount > 0)
        .map((t) => {
          const pct = Math.round((t.amount / grand) * 100)
          return (
            <Stack key={t.label} direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2">{t.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {fmtINR(t.amount)} · {pct}%
              </Typography>
            </Stack>
          )
        })}
    </Stack>
  )
}
