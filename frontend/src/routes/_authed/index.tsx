import { createFileRoute, useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useAuth } from '@/app/auth-context'
import { useThemeMode } from '@/hooks/useTheme'
import { Btn, Card } from '@/components/primitives'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  const { mode, toggle } = useThemeMode()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate({ to: '/login' })
  }

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 8 }}>
        <Stack spacing={3} sx={{ alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h1">Finance ERP</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Signed in as{' '}
              <Box component="span" sx={{ fontWeight: 600 }}>
                {user?.username ?? '…'}
              </Box>{' '}
              · {user?.role}
            </Typography>
          </Box>

          <Stack direction="row" spacing={2}>
            <Btn variant="ghost" onClick={toggle}>
              Switch theme (current: {mode})
            </Btn>
            <Btn variant="danger" onClick={handleLogout}>
              Logout
            </Btn>
          </Stack>

          <Card sx={{ width: '100%' }}>
            <Stack spacing={1.5}>
              <Typography variant="overline">KYC · Smoke test</Typography>
              <Typography sx={{ color: 'primary.main' }} className="mono">
                LMS-2026-847291
              </Typography>
              <Typography variant="body2">
                If this card has soft shadow, 14px radius, and the loan number above
                is in monospace + accent blue, tokens are flowing correctly.
              </Typography>
            </Stack>
          </Card>
        </Stack>
      </Box>
    </Container>
  )
}
