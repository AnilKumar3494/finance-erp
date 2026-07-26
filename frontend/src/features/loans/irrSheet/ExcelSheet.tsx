import Box from '@mui/material/Box'

// A faithful Excel-style grid. The three IRR tabs are described as matrices of
// these cells and rendered here, so the "as in the workbook" look lives in one
// place: thin gridlines, Calibri-ish type, right-aligned boxed value cells, the
// grey canvas and blue input fills of the Input sheet.

export interface Cell {
  text?: string
  /** colspan */ span?: number
  /** rowspan */ rspan?: number
  align?: 'left' | 'center' | 'right'
  bold?: boolean
  italic?: boolean
  /** cell fill, mirroring the workbook */ fill?: 'grey' | 'blue' | 'header' | 'title'
  /** draw a full box border (the workbook's value cells) */ box?: boolean
  /** only an underline (the workbook's form fields) */ underline?: boolean
  color?: string
  size?: number
  /**
   * Makes the cell a live input (the calculator page). The input inherits the
   * cell's look — the workbook's blue fill is the "you can type here" signal,
   * exactly as in Excel.
   */
  input?: {
    value: string
    onChange: (v: string) => void
    type?: 'text' | 'number' | 'date'
    placeholder?: string
  }
}

// null marks a position covered by a preceding span — skipped in render.
export type SheetRow = (Cell | null)[]

const FILL: Record<NonNullable<Cell['fill']>, string> = {
  grey: '#d9d9d9',
  blue: '#c5d9f1',
  header: '#f2f2f2',
  title: 'transparent',
}

export function ExcelSheet({
  rows,
  colWidths,
  minWidth,
  fill,
  fontSize = 12,
}: {
  rows: SheetRow[]
  /** px width per column; falls back to a default. */
  colWidths?: number[]
  minWidth?: number
  /**
   * Stretch the grid to the container instead of sitting at its natural pixel
   * width. Column proportions are preserved (they become percentages), so the
   * sheet still reads as the workbook — just larger. `minWidth` still applies,
   * so narrow screens scroll rather than crush the columns.
   */
  fill?: boolean
  /** Base cell type size; row height scales with it. */
  fontSize?: number
}) {
  const totalCols = colWidths?.reduce((a, b) => a + b, 0) ?? 0
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          // The column widths were authored against 12px type, so a larger
          // font needs a proportionally larger floor — otherwise narrow screens
          // squeeze the columns and ellipsis-truncate the labels.
          minWidth: minWidth ? Math.round(minWidth * (fontSize / 12)) : 'auto',
          width: fill ? '100%' : undefined,
          fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
          fontSize,
          color: '#1a1a1a',
          '& td': {
            padding: `${Math.round(fontSize / 6)}px ${Math.round(fontSize / 2)}px`,
            height: Math.round(fontSize * 1.7),
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.3,
          },
        }}
      >
        {colWidths && (
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: fill && totalCols ? `${(w / totalCols) * 100}%` : w }} />
            ))}
          </colgroup>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                if (cell === null) return null
                const style: React.CSSProperties = {
                  textAlign: cell.align ?? 'left',
                  fontWeight: cell.bold ? 700 : 400,
                  fontStyle: cell.italic ? 'italic' : undefined,
                  background: cell.fill ? FILL[cell.fill] : undefined,
                  color: cell.color,
                  // Cells carry their own absolute sizes (the workbook's 10/11/
                  // 13px hierarchy), so they have to be scaled by the same
                  // factor as the base — otherwise raising `fontSize` moves
                  // only the handful of cells that don't set one.
                  fontSize: cell.size ? Math.round(cell.size * (fontSize / 12)) : undefined,
                  fontVariantNumeric: 'tabular-nums',
                }
                // Assign the borders only when they apply. Setting
                // `borderBottom: undefined` alongside the `border` shorthand
                // clears the bottom edge the shorthand just set, which left
                // every boxed cell open at the bottom — invisible mid-block
                // (the next row draws its own top border) but plainly broken on
                // the last row of a block.
                if (cell.box) style.border = '1px solid #a6a6a6'
                if (cell.underline) style.borderBottom = '1px solid #808080'
                return (
                  <td key={c} colSpan={cell.span} rowSpan={cell.rspan} style={style}>
                    {cell.input ? (
                      <input
                        type={cell.input.type ?? 'text'}
                        inputMode={cell.input.type === 'number' ? 'decimal' : undefined}
                        value={cell.input.value}
                        placeholder={cell.input.placeholder}
                        onChange={(e) => cell.input!.onChange(e.target.value)}
                        style={{
                          width: '100%',
                          border: 'none',
                          outline: 'none',
                          background: 'transparent',
                          textAlign: cell.align ?? 'left',
                          font: 'inherit',
                          color: 'inherit',
                          padding: 0,
                        }}
                      />
                    ) : (
                      (cell.text ?? '')
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  )
}
