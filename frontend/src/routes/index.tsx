import { createFileRoute, Link } from '@tanstack/react-router'
import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material'

import { useThemeMode } from '@/hooks/useTheme'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const { mode, toggle } = useThemeMode()

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 8 }}>
        <Stack spacing={3} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h1">Finance ERP</Typography>
          <Typography color="text.secondary">
            Foundation up. Tokens loaded, MUI theme bridged. Toggle the mode below
            to verify CSS variables and the MUI palette swap together.
          </Typography>

          <Stack direction="row" spacing={2}>
            <Button component={Link} to="/login" variant="contained">
              Go to login
            </Button>
            <Button onClick={toggle} variant="outlined">
              Switch theme (current: {mode})
            </Button>
          </Stack>

          {/* Visual smoke-test: Paper + accent text + mono utility */}
          <Paper sx={{ p: 3, width: '100%' }}>
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
          </Paper>
        </Stack>
      </Box>
    </Container>
  )
}
