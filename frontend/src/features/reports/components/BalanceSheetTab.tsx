import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableRow from '@mui/material/TableRow'

import { useBalanceSheet } from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'

const inr = (s: string) => fmtINR(Number(s))
// Render a stored-positive figure as the deduction it is in the statement.
const neg = (s: string) => String(-Number(s))

function Line({
  label,
  value,
  bold = false,
  color,
  indent = false,
}: {
  label: string
  value: string
  bold?: boolean
  color?: string
  indent?: boolean
}) {
  return (
    <TableRow sx={bold ? { bgcolor: 'action.hover' } : undefined}>
      <TableCell sx={{ pl: indent ? 4 : 2, fontWeight: bold ? 700 : 400 }}>{label}</TableCell>
      <TableCell align="right" sx={{ fontWeight: bold ? 700 : 400, color }}>
        {inr(value)}
      </TableCell>
    </TableRow>
  )
}

/**
 * Balance Sheet — the as-of-today position. Assets (cash + HP receivables)
 * against how they are funded (capital, retained earnings, down payments,
 * unearned interest). Under flat-rate share accounting the two sides agree;
 * any residual (rounding, waived cycles) is shown as an explicit difference
 * line rather than hidden.
 */
export function BalanceSheetTab() {
  const query = useBalanceSheet()
  const report = query.data

  const difference = report ? Number(report.difference) : 0

  return (
    <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
      {report && (
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            As of {fmtDate(report.as_of)} · {report.open_loans} open finances
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              alignItems: 'start',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 560px))' },
            }}
          >
            <Card sx={{ p: 0, overflow: 'hidden' }}>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                  <TableBody>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell sx={{ fontWeight: 700 }}>ASSETS</TableCell>
                      <TableCell />
                    </TableRow>
                    <Line
                      label="Cash in hand"
                      value={report.cash_in_hand}
                      color={Number(report.cash_in_hand) < 0 ? 'error.main' : undefined}
                    />
                    <Line label="HP receivable — principal" value={report.receivable_principal} indent />
                    <Line label="HP receivable — unearned interest" value={report.unearned_interest} indent />
                    <Line label="HP receivable (total outstanding)" value={report.receivable_total} />
                    <Line label="TOTAL ASSETS" value={report.total_assets} bold />
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>

            <Card sx={{ p: 0, overflow: 'hidden' }}>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                  <TableBody>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell sx={{ fontWeight: 700 }}>FUNDED BY</TableCell>
                      <TableCell />
                    </TableRow>
                    <Line label="Capital introduced" value={report.capital_in} indent />
                    <Line label="Less: capital withdrawn" value={neg(report.capital_out)} indent />
                    <Line label="Capital (net)" value={report.capital_net} />
                    <Line label="Interest earned to date" value={report.interest_earned} indent />
                    <Line label="Other income to date" value={report.other_income} indent />
                    <Line label="Less: expenses to date" value={neg(report.expenses)} indent />
                    <Line label="Less: bad debt written off" value={neg(report.bad_debt_written_off)} indent />
                    <Line label="Retained earnings" value={report.retained_earnings} />
                    <Line label="Down payments received" value={report.down_payments_received} />
                    <Line label="Unearned interest (in receivables)" value={report.unearned_interest} />
                    <Line label="TOTAL" value={report.total_funded} bold />
                    {difference !== 0 && (
                      <Line
                        label="Unreconciled difference"
                        value={report.difference}
                        color="warning.main"
                      />
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 900 }}>
            Cash in hand is the Day Report&apos;s running position: all collections, capital and
            other income, minus finance disbursed, expenses, and withdrawals — since the first
            record. Receivables split each open finance&apos;s outstanding into principal and
            unearned interest by its flat-rate share. Retained earnings = interest earned + other
            income − expenses − bad-debt principal written off. If cash in hand looks too negative,
            record your opening capital under Reports → Capital &amp; Expenses. The unreconciled
            difference is per-payment rounding and waived cycles, kept visible on purpose.
          </Typography>
        </Stack>
      )}
    </AsyncSection>
  )
}
