import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Link } from '@tanstack/react-router'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import PeopleOutlined from '@mui/icons-material/PeopleOutlined'
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined'
import type { SvgIconComponent } from '@mui/icons-material'

import { Card } from '@/components/primitives'

// Subset of app routes the shortcuts link to — typed so TanStack's <Link to>
// stays type-checked against the route tree.
type ShortcutRoute =
  | '/finances/new'
  | '/transactions'
  | '/customers'
  | '/vehicles'
  | '/reports'
  | '/team'

interface Shortcut {
  label: string
  description: string
  to: ShortcutRoute
  icon: SvgIconComponent
}

export function QuickActions({ isAdmin }: { isAdmin: boolean }) {
  const shortcuts: Shortcut[] = [
    {
      label: 'New finance',
      description: 'Start a loan application',
      to: '/finances/new',
      icon: AccountBalanceOutlined,
    },
    {
      label: 'Collections',
      description: 'Record payments & worklist',
      to: '/transactions',
      icon: ReceiptLongOutlined,
    },
    {
      label: 'Customers',
      description: 'Browse & manage customers',
      to: '/customers',
      icon: PeopleOutlined,
    },
    {
      label: 'Vehicles',
      description: 'Inventory & collateral',
      to: '/vehicles',
      icon: DirectionsCarOutlined,
    },
    ...(isAdmin
      ? ([
          {
            label: 'Reports',
            description: 'Portfolio & collections',
            to: '/reports',
            icon: AssessmentOutlined,
          },
          {
            label: 'Team',
            description: 'Manage user accounts',
            to: '/team',
            icon: ManageAccountsOutlined,
          },
        ] satisfies Shortcut[])
      : []),
  ]

  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 1.5 }}>
        Quick Actions
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        }}
      >
        {shortcuts.map((s) => {
          const Icon = s.icon
          return (
            <Box
              key={s.to}
              component={Link}
              to={s.to}
              sx={{ textDecoration: 'none', display: 'block', height: '100%' }}
            >
              <Card
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
                    {s.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {s.description}
                  </Typography>
                </Box>
              </Card>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
