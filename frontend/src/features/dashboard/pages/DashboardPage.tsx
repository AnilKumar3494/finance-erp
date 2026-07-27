import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'

import { useAuth } from '@/app/auth-context'
import { useCustomerReport, useDashboardSummary } from '@/api/queries/reports'
import { fmtINR } from '@/lib/format'
import { KPI_GRID_SX } from '@/features/reports/components/KpiCard'
import { AsyncSection } from '@/features/reports/components/AsyncSection'
import { money } from '@/features/reports/reportUtils'
import { greetingForNow } from '../greeting'
import { StatTile } from '../components/StatTile'
import { ActionQueue } from '../components/ActionQueue'
import { AdminAnalytics } from '../components/AdminAnalytics'
import { QuickActions } from '../components/QuickActions'

export function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const displayName = user?.full_name?.trim() || user?.username || 'there'

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h2">
          {greetingForNow()}, {displayName}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {isAdmin
            ? 'A snapshot of the portfolio, and what needs your attention.'
            : "Here's your work at a glance."}
        </Typography>
      </Box>

      <Stack spacing={4}>
        {isAdmin ? <AdminKpis /> : <EmployeeKpis />}
        <ActionQueue isAdmin={isAdmin} />
        {isAdmin && <AdminAnalytics />}
        <QuickActions isAdmin={isAdmin} />
      </Stack>
    </Box>
  )
}

function AdminKpis() {
  const navigate = useNavigate()
  const summary = useDashboardSummary()

  return (
    <AsyncSection isLoading={summary.isLoading} isError={summary.isError} error={summary.error}>
      {summary.data && (
        <Box sx={KPI_GRID_SX}>
          <StatTile
            label="Customers"
            value={String(summary.data.total_customers)}
            onClick={() => navigate({ to: '/customers', search: { page: 1 } })}
          />
          <StatTile
            label="Active loans"
            value={String(summary.data.total_active_loans)}
            onClick={() => navigate({ to: '/finances', search: { page: 1, status: 'ACTIVE' } })}
          />
          <StatTile
            label="Total collected"
            value={fmtINR(money(summary.data.total_amount_collected))}
            accent="success.main"
          />
          <StatTile
            label="Outstanding"
            value={fmtINR(money(summary.data.total_principal_outstanding))}
            accent="error.main"
          />
          <StatTile
            label="Pending collections"
            value={fmtINR(money(summary.data.total_pending_collections))}
            accent="warning.main"
          />
          <StatTile
            label="Awaiting closure"
            value={String(summary.data.total_awaiting_closure_loans)}
            onClick={() =>
              navigate({ to: '/finances', search: { page: 1, status: 'AWAITING_CLOSURE' } })
            }
          />
          <StatTile
            label="Bad debt"
            value={String(
              summary.data.total_bad_debt_proposed_loans + summary.data.total_bad_debt_loans,
            )}
            hint={`${summary.data.total_bad_debt_proposed_loans} proposed`}
            accent="warning.main"
            // The tile counts both stages but the list filters on one status,
            // so send the click to the stage that actually has rows: proposals
            // first (they need a decision), else the already-written-off loans.
            // Landing on an empty list when the tile reads 1 is worse than
            // landing on the less urgent of the two.
            onClick={() =>
              navigate({
                to: '/finances',
                search: {
                  page: 1,
                  status:
                    summary.data.total_bad_debt_proposed_loans > 0
                      ? 'BAD_DEBT_PROPOSED'
                      : 'BAD_DEBT',
                },
              })
            }
          />
          <StatTile
            label="Vehicles"
            value={String(summary.data.total_vehicles)}
            onClick={() => navigate({ to: '/vehicles', search: { page: 1 } })}
          />
        </Box>
      )}
    </AsyncSection>
  )
}

// Employees can't hit the admin summary; the customer report is the one report
// endpoint they may call (scoped to their assignments server-side), so it backs
// their two headline counts.
function EmployeeKpis() {
  const navigate = useNavigate()
  const report = useCustomerReport(1, 1)

  return (
    <AsyncSection isLoading={report.isLoading} isError={report.isError} error={report.error}>
      {report.data && (
        <Box sx={KPI_GRID_SX}>
          <StatTile
            label="My customers"
            value={String(report.data.total_customers)}
            onClick={() => navigate({ to: '/customers', search: { page: 1 } })}
          />
          <StatTile
            label="With active loans"
            value={String(report.data.customers_with_active_loans)}
          />
        </Box>
      )}
    </AsyncSection>
  )
}
