import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableRow from '@mui/material/TableRow'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'

import { useBalanceSheet, type BalanceSheetReport } from '@/api/queries/reports'
import { Btn, Card } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { downloadCsv } from '../csvExport'
import { downloadStatementPdf, pdfINR } from '../reportPdf'

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

function exportCsv(report: BalanceSheetReport) {
  downloadCsv(
    `balance_sheet_${report.as_of}.csv`,
    ['Section', 'Item', 'Amount'],
    [
      ['Assets', 'Cash in hand', report.cash_in_hand],
      ['Assets', 'HP receivable - principal', report.receivable_principal],
      ['Assets', 'HP receivable - unearned interest', report.unearned_interest],
      ['Assets', 'HP receivable (total outstanding)', report.receivable_total],
      ['Assets', 'Total assets', report.total_assets],
      ['Funded by', 'Capital introduced', report.capital_in],
      ['Funded by', 'Capital withdrawn', report.capital_out],
      ['Funded by', 'Capital (net)', report.capital_net],
      ['Funded by', 'Interest earned to date', report.interest_earned],
      ['Funded by', 'Other income to date', report.other_income],
      ['Funded by', 'Expenses to date', report.expenses],
      ['Funded by', 'Bad debt written off', report.bad_debt_written_off],
      ['Funded by', 'Retained earnings', report.retained_earnings],
      ['Funded by', 'Down payments received', report.down_payments_received],
      ['Funded by', 'Unearned interest (in receivables)', report.unearned_interest],
      ['Funded by', 'Total funded', report.total_funded],
      ['Funded by', 'Unreconciled difference', report.difference],
    ],
  )
}

function exportPdf(report: BalanceSheetReport) {
  downloadStatementPdf({
    filename: `Balance_Sheet_${report.as_of}.pdf`,
    title: 'Balance Sheet',
    subtitle: `As of ${fmtDate(report.as_of)}  ·  ${report.open_loans} open finances`,
    sections: [
      {
        heading: 'ASSETS',
        lines: [
          { label: 'Cash in hand', value: pdfINR(report.cash_in_hand) },
          { label: 'HP receivable — principal', value: pdfINR(report.receivable_principal), indent: true },
          { label: 'HP receivable — unearned interest', value: pdfINR(report.unearned_interest), indent: true },
          { label: 'HP receivable (total outstanding)', value: pdfINR(report.receivable_total) },
          { label: 'TOTAL ASSETS', value: pdfINR(report.total_assets), bold: true },
        ],
      },
      {
        heading: 'FUNDED BY',
        lines: [
          { label: 'Capital introduced', value: pdfINR(report.capital_in), indent: true },
          { label: 'Less: capital withdrawn', value: pdfINR(-Number(report.capital_out)), indent: true },
          { label: 'Capital (net)', value: pdfINR(report.capital_net) },
          { label: 'Interest earned to date', value: pdfINR(report.interest_earned), indent: true },
          { label: 'Other income to date', value: pdfINR(report.other_income), indent: true },
          { label: 'Less: expenses to date', value: pdfINR(-Number(report.expenses)), indent: true },
          { label: 'Less: bad debt written off', value: pdfINR(-Number(report.bad_debt_written_off)), indent: true },
          { label: 'Retained earnings', value: pdfINR(report.retained_earnings) },
          { label: 'Down payments received', value: pdfINR(report.down_payments_received) },
          { label: 'Unearned interest (in receivables)', value: pdfINR(report.unearned_interest) },
          { label: 'TOTAL', value: pdfINR(report.total_funded), bold: true },
          ...(Number(report.difference) !== 0
            ? [{ label: 'Unreconciled difference', value: pdfINR(report.difference) }]
            : []),
        ],
      },
    ],
    note:
      'Cash in hand is the running cash-book position: collections, capital, and other income minus ' +
      'finance disbursed, expenses, and withdrawals — since the first record. Receivables split each ' +
      'open finance’s outstanding into principal and unearned interest by its flat-rate share. The ' +
      'unreconciled difference is per-payment rounding and waived cycles, kept visible on purpose.',
  })
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
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              As of {fmtDate(report.as_of)} · {report.open_loans} open finances
            </Typography>
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={() => exportCsv(report)}
            >
              Export CSV
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<PictureAsPdfOutlinedIcon />}
              onClick={() => exportPdf(report)}
            >
              Download PDF
            </Btn>
          </Stack>

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
