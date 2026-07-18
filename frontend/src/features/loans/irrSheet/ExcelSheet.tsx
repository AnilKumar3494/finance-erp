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
}: {
  rows: SheetRow[]
  /** px width per column; falls back to a default. */
  colWidths?: number[]
  minWidth?: number
}) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          minWidth: minWidth ?? 'auto',
          fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
          fontSize: 12,
          color: '#1a1a1a',
          '& td': {
            padding: '2px 6px',
            height: 20,
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
              <col key={i} style={{ width: w }} />
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
                  fontSize: cell.size,
                  border: cell.box ? '1px solid #a6a6a6' : undefined,
                  borderBottom: cell.underline ? '1px solid #808080' : undefined,
                  fontVariantNumeric: 'tabular-nums',
                }
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
