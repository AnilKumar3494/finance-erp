import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useDashboardSummary, useLoanPortfolio } from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

export function OverviewTab() {
  const summary = useDashboardSummary()
  const portfolio = useLoanPortfolio()

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
          Loan Portfolio
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
