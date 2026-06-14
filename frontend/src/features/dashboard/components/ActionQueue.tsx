import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ButtonBase from '@mui/material/ButtonBase'
import { useNavigate } from '@tanstack/react-router'
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined'
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined'
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined'
import GavelOutlined from '@mui/icons-material/GavelOutlined'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'
import type { SvgIconComponent } from '@mui/icons-material'
import dayjs from 'dayjs'

import { Card, Spinner } from '@/components/primitives'
import { useDueCycleWorklist } from '@/api/queries/dueCycles'
import { usePendingConfirmations } from '@/api/queries/transactions'
import { useDashboardSummary } from '@/api/queries/reports'

interface QueueItem {
  key: string
  label: string
  count: number
  icon: SvgIconComponent
  tone: string
  go: () => void
}

// "Needs attention" worklist. Every data source here is RBAC-scoped server-side
// (due cycles + pending confirmations use get_current_user, so an employee sees
// only their own); the admin-only items read the dashboard summary, which is
// fetched only when isAdmin so employees never trigger a 403.
export function ActionQueue({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate()
  const today = dayjs().format('YYYY-MM-DD')

  const due = useDueCycleWorklist({ unpaid_only: true, due_before: today, page: 1, page_size: 1 })
  const pending = usePendingConfirmations(1, 1)
  const summary = useDashboardSummary(isAdmin)

  const loading = due.isLoading || pending.isLoading || (isAdmin && summary.isLoading)

  const items: QueueItem[] = [
    {
      key: 'due',
      label: 'Due & overdue EMIs',
      count: due.data?.total ?? 0,
      icon: PaymentsOutlined,
      tone: 'error.main',
      go: () => navigate({ to: '/transactions', search: { view: 'due', page: 1 } }),
    },
    {
      key: 'confirm',
      label: 'Payments awaiting confirmation',
      count: pending.data?.total ?? 0,
      icon: FactCheckOutlined,
      tone: 'warning.main',
      go: () => navigate({ to: '/transactions', search: { view: 'confirmations', page: 1 } }),
    },
    ...(isAdmin
      ? [
          {
            key: 'closure',
            label: 'Loans awaiting closure',
            count: summary.data?.total_awaiting_closure_loans ?? 0,
            icon: TaskAltOutlined,
            tone: 'info.main',
            go: () =>
              navigate({ to: '/finances', search: { page: 1, status: 'AWAITING_CLOSURE' } }),
          },
          {
            key: 'baddebt',
            label: 'Bad-debt proposals to review',
            count: summary.data?.total_bad_debt_proposed_loans ?? 0,
            icon: GavelOutlined,
            tone: 'warning.main',
            go: () => navigate({ to: '/transactions', search: { view: 'baddebt', page: 1 } }),
          },
        ]
      : []),
  ]

  const outstanding = items.reduce((n, it) => n + it.count, 0)

  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 1.5 }}>
        Needs attention
      </Typography>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <Spinner size={24} />
          </Box>
        ) : outstanding === 0 ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              You&apos;re all caught up — nothing needs attention right now.
            </Typography>
          </Box>
        ) : (
          <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
            {items.map((it) => {
              const Icon = it.icon
              const active = it.count > 0
              return (
                <ButtonBase
                  key={it.key}
                  onClick={it.go}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    px: 2.5,
                    py: 1.75,
                    width: '100%',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', color: active ? it.tone : 'text.disabled' }}>
                    <Icon fontSize="small" />
                  </Box>
                  <Typography variant="body2" sx={{ flex: 1, color: 'text.primary' }}>
                    {it.label}
                  </Typography>
                  <Typography
                    variant="h3"
                    sx={{ fontSize: 18, color: active ? it.tone : 'text.secondary' }}
                  >
                    {it.count}
                  </Typography>
                  <ChevronRightOutlined sx={{ fontSize: 18, color: 'text.disabled' }} />
                </ButtonBase>
              )
            })}
          </Stack>
        )}
      </Card>
    </Box>
  )
}
