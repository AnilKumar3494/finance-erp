import { useRef, type ComponentProps, type ReactNode } from 'react'
import TableContainer from '@mui/material/TableContainer'

import { TopScrollbar } from '@/components/infinite/TopScrollbar'

type TableContainerProps = ComponentProps<typeof TableContainer>

// A TableContainer that scrolls sideways AND carries a mirrored scrollbar above
// it. A wide table's native horizontal bar sits at the bottom of the scroll
// area, so on a long table you had to scroll to the end before you could pan
// the columns — and on a short viewport it was off screen entirely.
//
// TopScrollbar hides itself unless the target genuinely overflows, so this is a
// drop-in for TableContainer: a table that fits looks exactly as before.
export function ScrollableTable({
  children,
  sx,
  ...rest
}: TableContainerProps & { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <TopScrollbar targetRef={scrollRef} />
      <TableContainer
        ref={scrollRef}
        sx={[{ overflowX: 'auto' }, ...(Array.isArray(sx) ? sx : [sx])]}
        {...rest}
      >
        {children}
      </TableContainer>
    </>
  )
}
