import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  useDashboardSummary,
  useLoanPortfolio,
  useMonthlyTrends,
} from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { fmtMonthShort, money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { MiniBarChart } from './MiniBarChart'
import { RangeToggle } from './RangeToggle'

export function OverviewTab() {
  const [trendsMonths, setTrendsMonths] = useState(3)

  const summary = useDashboardSummary()
  const portfolio = useLoanPortfolio()
  const trends = useMonthlyTrends(trendsMonths)

  return (
    <Stack spacing={4}>
      <AsyncSection
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
      >
        {summary.data && (
          <Box sx={KPI_GRID_SX}>
            <KpiCard label="Customers" value={String(summary.data.total_customers)} />
            <KpiCard label="Active loans" value={String(summary.data.total_active_loans)} />
            <KpiCard
              label="Total collected"
              value={fmtINR(money(summary.data.total_amount_collected))}
              accent="success.main"
            />
            <KpiCard
              label="Outstanding"
              value={fmtINR(money(summary.data.total_principal_outstanding))}
              accent="error.main"
            />
            <KpiCard
              label="Awaiting closure"
              value={String(summary.data.total_awaiting_closure_loans)}
            />
            <KpiCard label="Closed loans" value={String(summary.data.total_closed_loans)} />
            <KpiCard
              label="Bad debt"
              value={String(
                summary.data.total_bad_debt_proposed_loans +
                  summary.data.total_bad_debt_loans,
              )}
              hint={`${summary.data.total_bad_debt_proposed_loans} proposed`}
              accent="warning.main"
            />
            <KpiCard label="Vehicles" value={String(summary.data.total_vehicles)} />
          </Box>
        )}
      </AsyncSection>

      <Box>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Loan portfolio
        </Typography>
        <AsyncSection
          isLoading={portfolio.isLoading}
          isError={portfolio.isError}
          error={portfolio.error}
        >
          {portfolio.data && (
            <Card sx={{ p: 0, overflow: 'hidden' }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                }}
              >
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
                <PortfolioStat
                  label="Avg interest rate"
                  value={`${portfolio.data.average_interest_rate}%`}
                />
                <PortfolioStat
                  label="Avg tenure"
                  value={`${portfolio.data.average_tenure} mo`}
                />
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
          <Typography variant="h3">Trends</Typography>
          <RangeToggle value={trendsMonths} onChange={setTrendsMonths} />
        </Stack>
        <AsyncSection
          isLoading={trends.isLoading}
          isError={trends.isError}
          error={trends.error}
        >
          {trends.data && (
            <Stack spacing={3}>
              <Card>
                <Typography variant="caption" color="text.secondary">
                  Collections
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <MiniBarChart
                    data={trends.data.collections.map((c) => ({
                      label: fmtMonthShort(c.month),
                      value: money(c.amount),
                    }))}
                    formatValue={(n) => fmtINR(n)}
                    barColor="success.main"
                  />
                </Box>
              </Card>
              <Box
                sx={{
                  display: 'grid',
                  gap: 3,
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                }}
              >
                <Card>
                  <Typography variant="caption" color="text.secondary">
                    New customers
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <MiniBarChart
                      height={150}
                      data={trends.data.new_customers.map((c) => ({
                        label: fmtMonthShort(c.month),
                        value: c.count,
                      }))}
                    />
                  </Box>
                </Card>
                <Card>
                  <Typography variant="caption" color="text.secondary">
                    New loans
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <MiniBarChart
                      height={150}
                      data={trends.data.new_loans.map((c) => ({
                        label: fmtMonthShort(c.month),
                        value: c.count,
                      }))}
                      barColor="info.main"
                    />
                  </Box>
                </Card>
              </Box>
            </Stack>
          )}
        </AsyncSection>
      </Box>
    </Stack>
  )
}

function PortfolioStat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <Box
      sx={{
        p: 2,
        borderRight: '1px solid',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ mt: 0.5, color: accent, fontSize: 18 }}>
        {value}
      </Typography>
    </Box>
  )
}
