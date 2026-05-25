import { createFileRoute } from '@tanstack/react-router'
import { Box, Container, Paper, Stack, Typography } from '@mui/material'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <Container maxWidth="sm">
      <Box sx={{ py: 8 }}>
        <Paper sx={{ p: 4 }}>
          <Stack spacing={2}>
            <Typography variant="h2">Sign in</Typography>
            <Typography color="text.secondary">
              Login form coming in Phase 4. Wires to POST /api/v1/auth/login.
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Container>
  )
}
