import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import PeopleOutlined from '@mui/icons-material/PeopleOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import CalculateOutlined from '@mui/icons-material/CalculateOutlined'
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
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
    | '/irr-sheet'
    | '/team'
    | '/settings'
  icon: SvgIconComponent
  showInBottomBar: boolean
  // When true, the item is only shown to ADMIN / SUPER_ADMIN (see
  // useVisibleNavItems in navUtils). The page itself also enforces this.
  adminOnly?: boolean
  // Only SUPER_ADMIN sees it; the page enforces this too.
  superAdminOnly?: boolean
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
  { label: 'IRR Sheet', path: '/irr-sheet', icon: CalculateOutlined, showInBottomBar: false },
  {
    label: 'Team',
    path: '/team',
    icon: ManageAccountsOutlined,
    showInBottomBar: false,
    adminOnly: true,
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: SettingsOutlined,
    showInBottomBar: false,
    superAdminOnly: true,
  },
] as const

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    title?: string
  }
}
