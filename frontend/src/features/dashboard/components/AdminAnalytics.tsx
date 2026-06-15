import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'

import {
  useCollectionChart,
  useCollectionReport,
  useLoanPortfolio,
  useMonthlyTrends,
  type CollectionReport,
} from '@/api/queries/reports'
import { Btn, Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from '@/features/reports/components/AsyncSection'
import { MiniBarChart } from '@/features/reports/components/MiniBarChart'
import { RangeToggle } from '@/features/reports/components/RangeToggle'
import { fmtMonthShort, money } from '@/features/reports/reportUtils'

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'gpay', label: 'GPay' },
  { key: 'phonepe', label: 'PhonePe' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'other', label: 'Other' },
] as const

const METHOD_DAYS = 30

// Admin-only analytics block: portfolio totals, a collections trend with a
// time-range toggle, a payment-method split, and growth (new customers/loans).
// Reuses the Reports module's data hooks + chart atoms.
export function AdminAnalytics() {
  const navigate = useNavigate()
  const [months, setMonths] = useState(3)
  const [growthMonths, setGrowthMonths] = useState(3)

  const portfolio = useLoanPortfolio()
  const chart = useCollectionChart(months)
  const trends = useMonthlyTrends(growthMonths)
  const methods = useCollectionReport('daily', METHOD_DAYS)

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Loan portfolio
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
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 2, flexWrap: 'wrap' }}
        >
          <Typography variant="h3">Collections trend</Typography>
          <RangeToggle value={months} onChange={setMonths} />
        </Stack>
        <Card>
          <AsyncSection isLoading={chart.isLoading} isError={chart.isError} error={chart.error}>
            {chart.data && (
              <MiniBarChart
                data={chart.data.map((c) => ({ label: fmtMonthShort(c.month), value: money(c.amount) }))}
                formatValue={(n) => fmtINR(n)}
                barColor="success.main"
              />
            )}
          </AsyncSection>
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
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
        <Box>
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 2, flexWrap: 'wrap' }}
          >
            <Typography variant="h3">Growth</Typography>
            <RangeToggle value={growthMonths} onChange={setGrowthMonths} />
          </Stack>
          <AsyncSection isLoading={trends.isLoading} isError={trends.isError} error={trends.error}>
            {trends.data && (
              <Stack spacing={2}>
                <Card>
                  <Typography variant="caption" color="text.secondary">
                    New customers
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <MiniBarChart
                      height={130}
                      data={trends.data.new_customers.map((c) => ({ label: fmtMonthShort(c.month), value: c.count }))}
                    />
                  </Box>
                </Card>
                <Card>
                  <Typography variant="caption" color="text.secondary">
                    New loans
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <MiniBarChart
                      height={130}
                      barColor="info.main"
                      data={trends.data.new_loans.map((c) => ({ label: fmtMonthShort(c.month), value: c.count }))}
                    />
                  </Box>
                </Card>
              </Stack>
            )}
          </AsyncSection>
        </Box>
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
            <Box key={t.label}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{t.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {fmtINR(t.amount)} · {pct}%
                </Typography>
              </Stack>
              <Box sx={{ height: 8, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }}>
                <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: 'primary.main' }} />
              </Box>
            </Box>
          )
        })}
    </Stack>
  )
}
