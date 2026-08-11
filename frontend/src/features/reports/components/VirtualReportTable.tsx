import { useRef } from 'react'
import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Card } from '@/components/primitives'
import { SortableTh } from '@/components/sort/SortableTh'
import type { SortOrder, SortState } from '@/components/sort/useTableSort'

export interface VirtualColumn<T, F extends string> {
  /** Sortable field key; omit for a non-sortable column. */
  field?: F
  label: React.ReactNode
  align?: 'left' | 'right' | 'center'
  defaultDir?: SortOrder
  /** colgroup width (e.g. '12%'). Widths should sum to 100% across columns. */
  width: string
  renderCell: (row: T) => React.ReactNode
  cellSx?: SxProps<Theme>
  /**
   * This column's total. When set, the column appears in the totals block (its
   * `label` names the metric and `footerSx` colors the value). Columns without
   * a `footer` — e.g. the HP-number label column — are left out of the totals.
   */
  footer?: React.ReactNode
  footerSx?: SxProps<Theme>
}

/**
 * A labelled totals strip. Renders each column that carries a `footer` as a
 * name/value pair. Because it is a plain flex block — not table cells locked to
 * the data columns' widths — the numbers always show in full and never clip,
 * which is the whole reason totals live here rather than in the table body.
 */
function TotalsStrip<T, F extends string>({
  columns,
}: {
  columns: readonly VirtualColumn<T, F>[]
}) {
  const items = columns.filter((c) => c.footer !== undefined && c.footer !== '')
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: { xs: 2, sm: 3 },
        px: 2,
        py: 1.25,
      }}
    >
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', letterSpacing: '0.08em', lineHeight: 1 }}
      >
        Totals
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: { xs: 2, sm: 3 },
          ml: { sm: 'auto' },
        }}
      >
        {items.map((c, i) => (
          <Box key={i} sx={{ textAlign: 'right', minWidth: 64 }}>
            <Typography
              variant="caption"
              sx={{ display: 'block', color: 'text.secondary', whiteSpace: 'nowrap' }}
            >
              {c.label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, whiteSpace: 'nowrap', ...c.footerSx }}
            >
              {c.footer}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * A sortable report table that only mounts the rows currently on screen.
 *
 * The full-load report tabs (Fees, HP Register, HP Outstanding, HP Receivable)
 * fetch every finance at once — thousands of rows. Rendering them all into the
 * DOM is what made those tabs lag, so the body is virtualized with
 * `@tanstack/react-virtual`: only the visible window (plus a little overscan)
 * exists in the DOM, while spacer rows above and below reserve the scroll
 * height. `table-layout: fixed` + an explicit `<colgroup>` keeps the columns
 * from jittering as different rows scroll into view.
 *
 * The header stays pinned to the top of the scroll box. Totals (over the full
 * filtered set the caller passes in) live in their own block — pinned above the
 * table so they are always visible, and repeated as a full-width row at the very
 * end of the scroll. They are deliberately NOT in the data columns: crammed into
 * a narrow fee column a crore-sized sum would clip.
 */
export function VirtualReportTable<T, F extends string>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  sort,
  onSort,
  minWidth,
  estimateRowHeight = 45,
  maxHeight = '62vh',
  showTotals = true,
}: {
  columns: readonly VirtualColumn<T, F>[]
  rows: readonly T[]
  getRowKey: (row: T) => string
  onRowClick?: (row: T) => void
  sort: SortState<F>
  onSort: (field: F, defaultDir: SortOrder) => void
  minWidth: number
  estimateRowHeight?: number
  maxHeight?: number | string
  showTotals?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    getItemKey: (index) => getRowKey(rows[index]!),
    overscan: 10,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length ? virtualRows[0]!.start : 0
  const paddingBottom = virtualRows.length
    ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
    : 0

  const hasTotals = showTotals && columns.some((c) => c.footer !== undefined && c.footer !== '')

  // The sticky header must be OPAQUE: in dark mode `background.paper` is the
  // translucent `--surface` token (rgba white 0.05), so a bare `bgcolor` lets
  // the rows scrolling underneath bleed through. Composite it over an opaque
  // base the same way the theme's Card override does — solid `background.default`
  // plus the surface tint painted on top — so it stays opaque in both themes.
  const headerCellSx: SxProps<Theme> = {
    fontWeight: 600,
    backgroundColor: 'background.default',
    backgroundImage: (theme: Theme) =>
      `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper})`,
  }

  const spacer = (height: number) =>
    height > 0 ? (
      <TableRow style={{ height }}>
        <TableCell colSpan={columns.length} sx={{ p: 0, border: 0 }} />
      </TableRow>
    ) : null

  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      {hasTotals && (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
          <TotalsStrip columns={columns} />
        </Box>
      )}

      <TableContainer ref={scrollRef} sx={{ maxHeight, overflow: 'auto' }}>
        <Table
          stickyHeader
          size="small"
          sx={{
            tableLayout: 'auto',
            minWidth,
            '& .MuiTableCell-root': { whiteSpace: 'nowrap' },
          }}
        >
          <colgroup>
            {columns.map((col, i) => (
              <col key={i} style={{ width: col.width }} />
            ))}
          </colgroup>

          <TableHead>
            <TableRow>
              {columns.map((col, i) =>
                col.field ? (
                  <SortableTh
                    key={i}
                    field={col.field}
                    label={col.label}
                    align={col.align}
                    defaultDir={col.defaultDir ?? 'asc'}
                    activeField={sort.sort_by}
                    activeOrder={sort.sort_order}
                    onSort={onSort}
                    sx={headerCellSx}
                  />
                ) : (
                  <TableCell
                    key={i}
                    align={col.align}
                    sx={headerCellSx}
                  >
                    {col.label}
                  </TableCell>
                ),
              )}
            </TableRow>
          </TableHead>

          <TableBody>
            {spacer(paddingTop)}
            {virtualRows.map((vr) => {
              const row = rows[vr.index]!
              return (
                <TableRow
                  key={vr.key}
                  data-index={vr.index}
                  ref={virtualizer.measureElement}
                  hover
                  sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col, ci) => (
                    <TableCell key={ci} align={col.align} sx={col.cellSx}>
                      {col.renderCell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
            {spacer(paddingBottom)}
            {hasTotals && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  sx={{
                    p: 0,
                    borderTop: '2px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    whiteSpace: 'normal',
                  }}
                >
                  <TotalsStrip columns={columns} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}
