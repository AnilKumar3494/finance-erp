import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import PeopleOutlined from '@mui/icons-material/PeopleOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined'
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined'
import type { SvgIconComponent } from '@mui/icons-material'

export interface NavItem {
  label: string
  path:
    | '/'
    | '/customers'
    | '/finances'
    | '/transactions'
    | '/vehicles'
    | '/reports'
    | '/team'
    | '/reminders'
  icon: SvgIconComponent
  showInBottomBar: boolean
  // When true, the item is only shown to ADMIN / SUPER_ADMIN (see
  // useVisibleNavItems in navUtils). The page itself also enforces this.
  adminOnly?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardOutlined, showInBottomBar: true },
  { label: 'Customers', path: '/customers', icon: PeopleOutlined, showInBottomBar: true },
  { label: 'Finances', path: '/finances', icon: AccountBalanceOutlined, showInBottomBar: true },
  {
    label: 'Collections',
    path: '/transactions',
    icon: ReceiptLongOutlined,
    showInBottomBar: true,
  },
  { label: 'Vehicles', path: '/vehicles', icon: DirectionsCarOutlined, showInBottomBar: false },
  { label: 'Reports', path: '/reports', icon: AssessmentOutlined, showInBottomBar: false },
  {
    label: 'Team',
    path: '/team',
    icon: ManageAccountsOutlined,
    showInBottomBar: false,
    adminOnly: true,
  },
  {
    label: 'Reminders',
    path: '/reminders',
    icon: NotificationsActiveOutlined,
    showInBottomBar: false,
    adminOnly: true,
  },
] as const

export const BRAND = {
  full: 'Sri Adithya Finance',
  short: 'Sri',
} as const

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    title?: string
  }
}
