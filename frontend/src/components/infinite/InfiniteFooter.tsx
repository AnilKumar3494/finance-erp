import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

import { Spinner } from '@/components/primitives'

// "Showing X of Y" strip shown above an infinite list, replacing the pager's
// page count. `noun`/`nounPlural` name the row type (e.g. finance/finances).
export function CountBar({
  loaded,
  total,
  noun,
  nounPlural,
}: {
  loaded: number
  total: number
  noun: string
  nounPlural: string
}) {
  return (
    <Box sx={{ mb: 1, px: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        Showing {loaded} of {total} {total === 1 ? noun : nounPlural}
      </Typography>
    </Box>
  )
}

// Bottom strip under an infinite list: a spinner while the next page loads, or
// an end-of-list marker once everything is in.
export function LoadMoreFooter({
  hasNextPage,
  isFetchingNextPage,
  count,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  count: number
}) {
  if (isFetchingNextPage) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, py: 2 }}>
        <Spinner size={18} />
        <Typography variant="caption" color="text.secondary">
          Loading more…
        </Typography>
      </Box>
    )
  }
  if (!hasNextPage && count > 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <Typography variant="caption" color="text.secondary">
          End of list
        </Typography>
      </Box>
    )
  }
  return null
}
