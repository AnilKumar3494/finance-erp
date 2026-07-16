import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { Btn } from '@/components/primitives'

interface PagerBarProps {
  page: number
  totalPages: number
  /** e.g. "1,439 finances" — the count stat shown between the buttons. */
  label: string
  onPage: (next: number) => void
  /** Which side of the table this instance sits on — controls its margin. */
  edge?: 'top' | 'bottom'
}

/**
 * Pager row: ‹ Prev · Page X of Y · <count stat> · Next ›. Rendered both above
 * the table (so the totals are visible without scrolling) and below it.
 */
export function PagerBar({ page, totalPages, label, onPage, edge = 'top' }: PagerBarProps) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        ...(edge === 'bottom' ? { mt: 3 } : { mb: 2 }),
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </Btn>
      <Typography variant="body2" color="text.secondary">
        Page {page} of {totalPages} · {label}
      </Typography>
      <Btn variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next ›
      </Btn>
    </Stack>
  )
}
