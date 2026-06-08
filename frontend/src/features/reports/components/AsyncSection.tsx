import type { ReactNode } from 'react'
import Box from '@mui/material/Box'

import { ErrorBanner, Spinner } from '@/components/primitives'
import { mapReportError } from '../reportUtils'

// Wraps a report section's loading / error / ready states so each tab doesn't
// re-implement the same three branches.
export function AsyncSection({
  isLoading,
  isError,
  error,
  children,
}: {
  isLoading: boolean
  isError: boolean
  error?: unknown
  children: ReactNode
}) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (isError) {
    return <ErrorBanner message={mapReportError(error)} />
  }
  return <>{children}</>
}
