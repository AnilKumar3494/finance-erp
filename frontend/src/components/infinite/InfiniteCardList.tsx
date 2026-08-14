import type { ReactNode } from 'react'
import Box from '@mui/material/Box'

import { LIST_MAX_HEIGHT, LIST_MIN_HEIGHT, useInfiniteRows } from './listScroll'
import { LoadMoreFooter } from './InfiniteFooter'

// A virtualized, infinite-scrolling stack of cards for the mobile (below-md)
// breakpoint. Only the on-screen cards are mounted; the container reserves the
// full scroll height and positions each card by transform. `renderItem` draws
// one row's card. Hidden on md and up (the desktop table takes over there).
export function InfiniteCardList<T>({
  rows,
  getKey,
  estimateSize,
  renderItem,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
}: {
  rows: T[]
  getKey: (row: T) => string
  estimateSize: number
  renderItem: (row: T, index: number) => ReactNode
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  resetKey: string
}) {
  const { scrollRef, virtualizer, virtualRows, totalSize } = useInfiniteRows({
    count: rows.length,
    estimateSize,
    overscan: 8,
    getItemKey: (i) => getKey(rows[i]!),
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      <Box
        ref={scrollRef}
        sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
      >
        <Box sx={{ height: totalSize, position: 'relative' }}>
          {virtualRows.map((vr) => (
            <Box
              key={vr.key}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vr.start}px)`,
                pb: 1.5,
              }}
            >
              {renderItem(rows[vr.index]!, vr.index)}
            </Box>
          ))}
        </Box>
      </Box>
      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        count={rows.length}
      />
    </Box>
  )
}
