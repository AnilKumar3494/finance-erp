import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import { fmtINR } from '@/lib/format'
import type { AmortRow } from '../irrMath'

// How each EMI splits into interest and principal once the true rate is applied
// — the sheet's `Amort sheet`, and the detail behind IrrBalanceChart.
//
// NOT the billing schedule. The customer is billed a flat EMI from due_cycles
// regardless of this split; this only explains where that money goes. The
// caption says so, because a table of numbers next to the real cycles will
// otherwise be read as the real cycles.
export function AmortScheduleTable({ rows }: { rows: AmortRow[] }) {
  if (rows.length === 0) return null

  const totalInterest = rows.reduce((a, r) => a + r.interest, 0)
  const totalPrincipal = rows.reduce((a, r) => a + r.principal, 0)

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        How each EMI divides up. The EMI itself never changes — early instalments are mostly
        interest, later ones mostly principal.
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 380 }}>
          <TableHead>
            <TableRow>
              <TableCell>EMI</TableCell>
              <TableCell align="right">Interest</TableCell>
              <TableCell align="right">Principal</TableCell>
              <TableCell align="right">Balance after</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.n}>
                <TableCell>{r.n}</TableCell>
                <TableCell align="right">{fmtINR(r.interest)}</TableCell>
                <TableCell align="right">{fmtINR(r.principal)}</TableCell>
                <TableCell align="right">{fmtINR(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {fmtINR(totalInterest)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {fmtINR(totalPrincipal)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}
