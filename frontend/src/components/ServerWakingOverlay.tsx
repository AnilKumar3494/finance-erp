import { useSyncExternalStore } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { isServerWaking, subscribeServerWaking } from '@/api/serverWake'
import { Card, Spinner } from '@/components/primitives'

export function ServerWakingOverlay() {
  const waking = useSyncExternalStore(subscribeServerWaking, isServerWaking)
  if (!waking) return null

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (theme) => theme.zIndex.modal + 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        bgcolor: 'var(--bg)',
      }}
    >
      <Card sx={{ maxWidth: 420, textAlign: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Spinner size={32} />
          <Typography variant="h2">Starting the Server</Typography>
          <Typography variant="body1" color="text.secondary">
            The server sleeps when nobody is using it. It takes about 1 to 2 minutes to start, and
            this page will continue on its own.
          </Typography>
        </Stack>
      </Card>
    </Box>
  )
}
