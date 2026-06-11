import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import PeopleOutlined from '@mui/icons-material/PeopleOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import type { SvgIconComponent } from '@mui/icons-material'

export interface NavItem {
  label: string
  path: '/' | '/customers' | '/finances' | '/transactions' | '/vehicles' | '/reports'
  icon: SvgIconComponent
  showInBottomBar: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardOutlined, showInBottomBar: true },
  { label: 'Customers', path: '/customers', icon: PeopleOutlined, showInBottomBar: true },
  { label: 'Finances', path: '/finances', icon: AccountBalanceOutlined, showInBottomBar: true },
  {
    label: 'Collections & Actions',
    path: '/transactions',
    icon: ReceiptLongOutlined,
    showInBottomBar: true,
  },
  { label: 'Vehicles', path: '/vehicles', icon: DirectionsCarOutlined, showInBottomBar: false },
  { label: 'Reports', path: '/reports', icon: AssessmentOutlined, showInBottomBar: false },
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
