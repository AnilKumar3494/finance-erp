import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

// Height of an infinite-scroll list's scroll container: the table/cards scroll
// inside this while the page's toolbar and filters stay put above it. The 300px
// offset roughly accounts for the app top bar + a list toolbar + filters; pages
// with more chrome above (e.g. KPI cards) pass a shorter value.
export const LIST_MAX_HEIGHT = 'calc(100dvh - 300px)'
export const LIST_MIN_HEIGHT = 340

// A sticky table header that stays OPAQUE while virtualized rows scroll under
// it — in dark mode the paper surface is a translucent token, so composite the
// surface tint over the opaque page background (the same stack the app top bar
// and the identity card use), otherwise rows bleed through the header. Uses CSS
// vars (plain strings) so it can be applied per-cell OR spread into a nested
// `& thead .MuiTableCell-root` selector.
// A plain style object (not the SxProps union) so it can be used directly as a
// cell `sx` AND nested as the value of a `& thead .MuiTableCell-root` selector.
export const stickyHeaderCellSx = {
  fontWeight: 600,
  backgroundColor: 'var(--bg)',
  backgroundImage: 'linear-gradient(var(--surface), var(--surface))',
}

interface UseInfiniteRowsOptions {
  count: number
  estimateSize: number
  getItemKey: (index: number) => string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  // Changes whenever the filter/sort set changes — the scroll jumps back to top
  // so a new query doesn't strand you mid-way down the previous results.
  resetKey: string
  overscan?: number
}

// Windowed rendering + fetch-on-scroll for an infinite list, shared by every
// converted table/card view. Owns the scroll element, the virtualizer, the
// auto-load trigger (fires `fetchNextPage` once the last mounted row reaches the
// end of what's loaded), and the scroll-to-top reset on filter/sort change.
export function useInfiniteRows({
  count,
  estimateSize,
  getItemKey,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
  overscan = 10,
}: UseInfiniteRowsOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const lastIndex = virtualRows[virtualRows.length - 1]?.index

  // Prefetch the next page a few rows before the very end, so the new rows are
  // usually in by the time the user reaches the bottom (and so dynamic row
  // re-measurement at the exact bottom can't stall the trigger).
  useEffect(() => {
    if (lastIndex === undefined) return
    if (lastIndex >= count - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [lastIndex, count, hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [resetKey])

  const paddingTop = virtualRows.length ? virtualRows[0]!.start : 0
  const paddingBottom = virtualRows.length
    ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
    : 0

  return {
    scrollRef,
    virtualizer,
    virtualRows,
    paddingTop,
    paddingBottom,
    totalSize: virtualizer.getTotalSize(),
  }
}
