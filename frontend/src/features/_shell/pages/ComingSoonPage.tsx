import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'

interface ComingSoonPageProps {
  module: string
}

export function ComingSoonPage({ module }: ComingSoonPageProps) {
  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', py: { xs: 4, md: 8 } }}>
      <Card>
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="overline">{module}</Typography>
          <Typography variant="h1">Coming soon</Typography>
          <Typography variant="body2">
            The {module} module is not built yet. The navigation shell wiring is
            verified — module pages will plug in here.
          </Typography>
        </Stack>
      </Card>
    </Box>
  )
}
