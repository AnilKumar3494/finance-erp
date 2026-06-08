import { getRouteApi } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'

import { useAuth } from '@/app/auth-context'
import { Card } from '@/components/primitives'
import { REPORT_TABS, type ReportTab } from '../tabs'
import { OverviewTab } from '../components/OverviewTab'
import { CollectionsTab } from '../components/CollectionsTab'
import { CustomersReportTab } from '../components/CustomersReportTab'
import { EmployeesTab } from '../components/EmployeesTab'

const routeApi = getRouteApi('/_authed/reports')

const TAB_LABELS: Record<ReportTab, string> = {
  overview: 'Overview',
  collections: 'Collections',
  customers: 'Customers',
  employees: 'Employees',
}

export function ReportsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const { tab } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const setTab = (next: ReportTab) =>
    navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        Reports
      </Typography>

      {!isAdmin ? (
        <Card>
          <Typography variant="h3">Restricted</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Reports are available to administrators only.
          </Typography>
        </Card>
      ) : (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs
              value={tab}
              onChange={(_, next: ReportTab) => setTab(next)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
            >
              {REPORT_TABS.map((t) => (
                <Tab key={t} value={t} label={TAB_LABELS[t]} />
              ))}
            </Tabs>
          </Box>

          {/* Only the active tab mounts, so each report fetches lazily on select. */}
          {tab === 'overview' && <OverviewTab />}
          {tab === 'collections' && <CollectionsTab />}
          {tab === 'customers' && <CustomersReportTab />}
          {tab === 'employees' && <EmployeesTab />}
        </>
      )}
    </Box>
  )
}
