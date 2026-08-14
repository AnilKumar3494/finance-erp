import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'

// A horizontal scrollbar mirrored ABOVE a wide scroll area. The lists and report
// tables scroll inside a tall (maxHeight) container, so the browser's own
// horizontal scrollbar sits far down the screen — to reach it you first scroll
// the page/table down. This proxies that scrollbar to the top of the table and
// keeps the two in lockstep, so a wide table can be panned sideways without
// hunting for the native bar.
//
// `targetRef` is the actual scroll element (the TableContainer). Render this
// directly above it and it stays hidden until the target genuinely overflows.
export function TopScrollbar({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)
  // Width of the target's full content and its visible viewport. `overflowing`
  // (scroll > client) decides whether we render the bar at all.
  const [scrollWidth, setScrollWidth] = useState(0)
  const [clientWidth, setClientWidth] = useState(0)

  useEffect(() => {
    const target = targetRef.current
    const bar = barRef.current
    if (!target || !bar) return

    const measure = () => {
      setScrollWidth(target.scrollWidth)
      setClientWidth(target.clientWidth)
    }
    measure()

    // Mirror scrollLeft both ways. A flag marks which element is driving the
    // current scroll so the echoed write on the other element doesn't loop.
    let syncing = false
    const onTarget = () => {
      if (syncing) return
      syncing = true
      bar.scrollLeft = target.scrollLeft
      syncing = false
    }
    const onBar = () => {
      if (syncing) return
      syncing = true
      target.scrollLeft = bar.scrollLeft
      syncing = false
    }
    target.addEventListener('scroll', onTarget, { passive: true })
    bar.addEventListener('scroll', onBar, { passive: true })

    // The container can resize (window/layout) and its content can change width
    // (columns), either of which shifts the overflow — track both.
    const ro = new ResizeObserver(measure)
    ro.observe(target)
    if (target.firstElementChild) ro.observe(target.firstElementChild)

    return () => {
      target.removeEventListener('scroll', onTarget)
      bar.removeEventListener('scroll', onBar)
      ro.disconnect()
    }
  }, [targetRef])

  const overflowing = scrollWidth > clientWidth + 1

  return (
    <Box
      ref={barRef}
      aria-hidden
      sx={{
        display: overflowing ? 'block' : 'none',
        overflowX: 'auto',
        overflowY: 'hidden',
        // Always show the bar (overlay scrollbars would otherwise hide it).
        scrollbarWidth: 'auto',
        '&::-webkit-scrollbar': { height: 14 },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'var(--border-strong, rgba(128,128,128,0.5))',
          borderRadius: 7,
        },
      }}
    >
      <Box sx={{ width: scrollWidth, height: '1px' }} />
    </Box>
  )
}
