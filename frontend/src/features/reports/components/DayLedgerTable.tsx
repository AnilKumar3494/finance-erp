import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'

import type { DayReportDay, DayReportEntry, DayReportReceipt } from '@/api/queries/reports'
import { CASH_ENTRY_TYPE_LABELS } from '@/api/queries/cashEntries'
import { Card } from '@/components/primitives'
import { fmtINR } from '@/lib/format'

const inr = (s: string) => fmtINR(Number(s))

// GPAY → GPay etc. — mirror the transaction tables' labels without importing
// the loans feature.
const MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GPAY: 'GPay',
  PHONEPE: 'PhonePe',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
}

function receiptDesc(r: DayReportReceipt): string {
  const kind =
    r.transaction_type === 'DOWN_PAYMENT'
      ? 'Down payment'
      : r.cycle_number != null
        ? `EMI · cycle #${r.cycle_number}`
        : 'EMI'
  return `${kind} · ${MODE_LABELS[r.payment_mode] ?? r.payment_mode}`
}

// A capital/expense ledger row — no loan to click through to, so it renders
// as a plain (non-clickable) row.
function EntryRow({ entry, sno, direction }: { entry: DayReportEntry; sno: number; direction: 'in' | 'out' }) {
  const label = CASH_ENTRY_TYPE_LABELS[entry.entry_type] ?? entry.entry_type
  const amount = fmtINR(Number(entry.amount))
  return (
    <TableRow>
      <TableCell>{sno}</TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {entry.category ?? label}
        </Typography>
      </TableCell>
      <TableCell>—</TableCell>
      <TableCell>
        {label}
        {entry.notes ? ` · ${entry.notes}` : ''}
      </TableCell>
      <TableCell>—</TableCell>
      <TableCell align="right" sx={direction === 'in' ? { fontWeight: 600, color: 'success.main' } : undefined}>
        {direction === 'in' ? amount : '—'}
      </TableCell>
      <TableCell align="right" sx={direction === 'out' ? { fontWeight: 600, color: 'error.main' } : undefined}>
        {direction === 'out' ? amount : '—'}
      </TableCell>
    </TableRow>
  )
}

/**
 * One day's cash-book ledger: opening-position row, every receipt (money in)
 * and disbursement (money out), and a closing-position footer. Rows click
 * through to the loan's collections page.
 */
export function DayLedgerTable({ day }: { day: DayReportDay }) {
  const navigate = useNavigate()
  const openLoan = (loanId: string) =>
    navigate({ to: '/finances/$loanId/collections', params: { loanId } })

  let sno = 0

  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 780, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 48 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>HP No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>By</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Receipt</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Payment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell>{++sno}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>OPENING POSITION</TableCell>
              <TableCell>—</TableCell>
              <TableCell>—</TableCell>
              <TableCell>—</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {inr(day.opening_balance)}
              </TableCell>
              <TableCell align="right">—</TableCell>
            </TableRow>

            {day.receipts.map((r) => (
              <TableRow
                key={r.transaction_id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openLoan(r.loan_id)}
              >
                <TableCell>{++sno}</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {r.customer_name}
                  </Typography>
                </TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                  {r.hp_number ?? r.loan_number}
                </TableCell>
                <TableCell>{receiptDesc(r)}</TableCell>
                <TableCell>{r.collected_by ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>
                  {inr(r.amount)}
                </TableCell>
                <TableCell align="right">—</TableCell>
              </TableRow>
            ))}

            {day.entries_in.map((e) => (
              <EntryRow key={e.entry_id} entry={e} sno={++sno} direction="in" />
            ))}

            {day.payments.map((p) => (
              <TableRow
                key={p.loan_id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openLoan(p.loan_id)}
              >
                <TableCell>{++sno}</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {p.customer_name}
                  </Typography>
                </TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                  {p.hp_number ?? p.loan_number}
                </TableCell>
                <TableCell>{p.description}</TableCell>
                <TableCell>—</TableCell>
                <TableCell align="right">—</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                  {inr(p.amount)}
                </TableCell>
              </TableRow>
            ))}

            {day.entries_out.map((e) => (
              <EntryRow key={e.entry_id} entry={e} sno={++sno} direction="out" />
            ))}

            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell />
              <TableCell sx={{ fontWeight: 700 }}>TOTAL</TableCell>
              <TableCell colSpan={3}>
                <Typography variant="caption" color="text.secondary">
                  EMI {inr(day.emi_collection)} · Down payments {inr(day.down_payments)}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                {inr(day.total_receipts)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>
                {inr(day.total_payments)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell />
              <TableCell sx={{ fontWeight: 700 }}>CLOSING POSITION</TableCell>
              <TableCell colSpan={3} />
              <TableCell align="right" colSpan={2} sx={{ fontWeight: 700 }}>
                {inr(day.closing_balance)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}

/** Sub-note shown under the balance figures on both day-report views. */
export function PositionNote() {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Position = collections + capital &amp; other income − finance disbursed −
        expenses &amp; withdrawals, cumulative since the first record. Record non-loan
        movements under Reports → Capital &amp; Expenses.
      </Typography>
    </Box>
  )
}
