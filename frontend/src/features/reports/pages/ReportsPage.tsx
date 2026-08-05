import { getRouteApi } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'
import TodayOutlined from '@mui/icons-material/TodayOutlined'
import DateRangeOutlined from '@mui/icons-material/DateRangeOutlined'
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined'
import PercentOutlined from '@mui/icons-material/PercentOutlined'
import RequestQuoteOutlined from '@mui/icons-material/RequestQuoteOutlined'
import InsightsOutlined from '@mui/icons-material/InsightsOutlined'
import PeopleOutlined from '@mui/icons-material/PeopleOutlined'
import BadgeOutlined from '@mui/icons-material/BadgeOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import HourglassBottomOutlined from '@mui/icons-material/HourglassBottomOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import SavingsOutlined from '@mui/icons-material/SavingsOutlined'
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined'
import BalanceOutlined from '@mui/icons-material/BalanceOutlined'
import type { SvgIconComponent } from '@mui/icons-material'

import { useAuth } from '@/app/auth-context'
import { Btn, Card } from '@/components/primitives'
import type { ReportTab } from '../tabs'
import { OverviewTab } from '../components/OverviewTab'
import { CollectionsTab } from '../components/CollectionsTab'
import { CollectorsTab } from '../components/CollectorsTab'
import { CustomersReportTab } from '../components/CustomersReportTab'
import { EmployeesTab } from '../components/EmployeesTab'
import { DayReportTab } from '../components/DayReportTab'
import { MultiDayReportTab } from '../components/MultiDayReportTab'
import { ReceivedInterestTab } from '../components/ReceivedInterestTab'
import { HpOutstandingTab } from '../components/HpOutstandingTab'
import { HpReceivableTab } from '../components/HpReceivableTab'
import { HpRegisterTab } from '../components/HpRegisterTab'
import { FeesTab } from '../components/FeesTab'
import { CapitalExpensesTab } from '../components/CapitalExpensesTab'
import { PnlTab } from '../components/PnlTab'
import { BalanceSheetTab } from '../components/BalanceSheetTab'

const routeApi = getRouteApi('/_authed/reports')

interface ReportTile {
  tab: ReportTab
  label: string
  description: string
  icon: SvgIconComponent
}

interface ReportSection {
  title: string
  tiles: ReportTile[]
}

// The landing grid — every report the module offers, grouped like a ledger
// index. Adding a report = one tile here + one entry in REPORT_VIEWS.
const REPORT_SECTIONS: ReportSection[] = [
  {
    title: 'Daily books',
    tiles: [
      {
        tab: 'day',
        label: 'Day Report',
        description: 'Every receipt and disbursement on a date, with the running position.',
        icon: TodayOutlined,
      },
      {
        tab: 'multiday',
        label: 'Multi-Day Report',
        description: 'The same cash book stacked day by day across a date range.',
        icon: DateRangeOutlined,
      },
      {
        tab: 'collections',
        label: 'Collections',
        description: 'Daily or monthly collection totals split by payment mode.',
        icon: PaymentsOutlined,
      },
      {
        tab: 'collectors',
        label: 'By Collector',
        description: 'Collections per collector over a date range, with the payment-mode split.',
        icon: BadgeOutlined,
      },
    ],
  },
  {
    title: 'Capital & expenses',
    tiles: [
      {
        tab: 'cashbook',
        label: 'Capital & Expenses',
        description:
          'Record capital in/out, income, and expenses — feeds the Day Report position.',
        icon: SavingsOutlined,
      },
    ],
  },
  {
    title: 'Earnings',
    tiles: [
      {
        tab: 'interest',
        label: 'Received Interest',
        description: 'Interest earned on EMI collections in a period, per finance.',
        icon: PercentOutlined,
      },
      {
        tab: 'receivable',
        label: 'Receivable Interest',
        description: 'Interest still to be earned on each open finance.',
        icon: HourglassBottomOutlined,
      },
      {
        tab: 'fees',
        label: 'Fees',
        description:
          'Processing, documentation, DSC and RTO charges per finance, with totals.',
        icon: RequestQuoteOutlined,
      },
      {
        tab: 'pnl',
        label: 'Profit & Loss',
        description: 'Interest and other income against expenses for a period.',
        icon: TrendingUpOutlined,
      },
      {
        tab: 'balancesheet',
        label: 'Balance Sheet',
        description: 'Cash and receivables against capital and earnings, as of today.',
        icon: BalanceOutlined,
      },
    ],
  },
  {
    title: 'Hire purchase',
    tiles: [
      {
        tab: 'outstanding',
        label: 'HP Outstanding',
        description: 'Payable, collected, and outstanding per open finance.',
        icon: AccountBalanceOutlined,
      },
      {
        tab: 'register',
        label: 'HP Register',
        description: 'The full register of executed finances with terms and vehicles.',
        icon: MenuBookOutlined,
      },
    ],
  },
  {
    title: 'Portfolio & people',
    tiles: [
      {
        tab: 'overview',
        label: 'Overview',
        description: 'Business KPIs and loan-portfolio totals at a glance.',
        icon: InsightsOutlined,
      },
      {
        tab: 'customers',
        label: 'Customers',
        description: 'Per-customer principal, paid, and outstanding balances.',
        icon: PeopleOutlined,
      },
      {
        tab: 'employees',
        label: 'Employees',
        description: 'Collection performance and assignments per team member.',
        icon: BadgeOutlined,
      },
    ],
  },
]

const REPORT_VIEWS: Record<ReportTab, { title: string; render: () => React.ReactNode }> = {
  overview: { title: 'Overview', render: () => <OverviewTab /> },
  collections: { title: 'Collections', render: () => <CollectionsTab /> },
  collectors: { title: 'By Collector', render: () => <CollectorsTab /> },
  customers: { title: 'Customers', render: () => <CustomersReportTab /> },
  employees: { title: 'Employees', render: () => <EmployeesTab /> },
  day: { title: 'Day Report', render: () => <DayReportTab /> },
  multiday: { title: 'Multi-Day Report', render: () => <MultiDayReportTab /> },
  interest: { title: 'Received Interest', render: () => <ReceivedInterestTab /> },
  outstanding: { title: 'HP Outstanding', render: () => <HpOutstandingTab /> },
  receivable: { title: 'Receivable Interest', render: () => <HpReceivableTab /> },
  register: { title: 'HP Register', render: () => <HpRegisterTab /> },
  fees: { title: 'Fees', render: () => <FeesTab /> },
  cashbook: { title: 'Capital & Expenses', render: () => <CapitalExpensesTab /> },
  pnl: { title: 'Profit & Loss', render: () => <PnlTab /> },
  balancesheet: { title: 'Balance Sheet', render: () => <BalanceSheetTab /> },
}

export function ReportsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const { tab } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const setTab = (next: ReportTab | undefined) =>
    navigate({ search: { tab: next }, replace: true })

  if (!isAdmin) {
    return (
      <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
        <Typography variant="h2" sx={{ mb: 3 }}>
          Reports
        </Typography>
        <Card>
          <Typography variant="h3">Restricted</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Reports are available to administrators only.
          </Typography>
        </Card>
      </Box>
    )
  }

  // A specific report is open — title, back-to-gallery link, and the view.
  if (tab) {
    const view = REPORT_VIEWS[tab]
    return (
      <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
        <Stack direction="row" spacing={2} sx={{ mb: 3, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Btn variant="ghost" size="sm" startIcon={<ArrowBackIcon />} onClick={() => setTab(undefined)}>
            All reports
          </Btn>
          <Typography variant="h2">{view.title}</Typography>
        </Stack>
        {view.render()}
      </Box>
    )
  }

  // Landing grid — the report gallery.
  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        Reports
      </Typography>
      <Stack spacing={4}>
        {REPORT_SECTIONS.map((section) => (
          <Box key={section.title}>
            <Typography variant="h3" sx={{ mb: 1.5 }}>
              {section.title}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              }}
            >
              {section.tiles.map((t) => {
                const Icon = t.icon
                return (
                  <Card
                    key={t.tab}
                    onClick={() => setTab(t.tab)}
                    sx={{
                      p: 2.5,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
                      '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
                    }}
                  >
                    <Box sx={{ display: 'flex', color: 'primary.main' }}>
                      <Icon />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h3" sx={{ fontSize: 15 }}>
                        {t.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t.description}
                      </Typography>
                    </Box>
                  </Card>
                )
              })}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
