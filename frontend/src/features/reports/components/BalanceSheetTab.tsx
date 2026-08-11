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

import { useState } from 'react'

import { useBalanceSheet, type BalanceSheetReport } from '@/api/queries/reports'
import { Btn, Card } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { ReportToggle, ReportToggleBar } from './ReportToggle'
import { downloadCsv } from '../csvExport'
import { downloadStatementPdf, pdfINR } from '../reportPdf'

const inr = (s: string) => fmtINR(Number(s))
// Render a stored-positive figure as the deduction it is in the statement.
const neg = (s: string) => String(-Number(s))

// Recompute the displayed sheet from the fully-recognised figures the backend
// returns, honouring the fee/penalty toggles. Turning a line OFF removes it from
// income (and, for fees, from cash) and re-derives the totals + difference — so
// switching penalty off restores the "raw" view where the penalty sits in the
// receivable with no matching income and the unreconciled difference grows back.
function computeView(r: BalanceSheetReport, showFees: boolean, showPenalties: boolean) {
  const feeInc = showFees ? Number(r.fee_income) : 0
  const penInc = showPenalties ? Number(r.penalty_income) : 0
  const penRecv = showPenalties ? Number(r.penalty_receivable) : 0

  // Fee income is retained cash, so dropping it removes it from cash too.
  const cash = Number(r.cash_in_hand) - (Number(r.fee_income) - feeInc)
  // When penalty is off it is not shown as its own receivable line — fold it
  // back into principal so total assets stay whole.
  const receivablePrincipal = Number(r.receivable_principal) + (Number(r.penalty_receivable) - penRecv)
  const retained =
    Number(r.interest_earned) +
    Number(r.other_income) +
    feeInc +
    penInc -
    Number(r.expenses) -
    Number(r.bad_debt_written_off)
  const totalAssets = cash + Number(r.receivable_total)
  const totalFunded =
    Number(r.capital_net) + retained + Number(r.down_payments_received) + Number(r.unearned_interest)
  return {
    cash,
    receivablePrincipal,
    penaltyReceivable: penRecv,
    feeIncome: feeInc,
    penaltyIncome: penInc,
    retained,
    totalAssets,
    totalFunded,
    difference: totalAssets - totalFunded,
    showFees,
    showPenalties,
  }
}

type SheetView = ReturnType<typeof computeView>

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

function exportCsv(report: BalanceSheetReport, v: SheetView) {
  downloadCsv(
    `balance_sheet_${report.as_of}.csv`,
    ['Section', 'Item', 'Amount'],
    [
      ['Assets', 'Cash in hand', String(v.cash)],
      ['Assets', 'HP receivable - principal', String(v.receivablePrincipal)],
      ['Assets', 'HP receivable - unearned interest', report.unearned_interest],
      ...(v.showPenalties
        ? [['Assets', 'HP receivable - penalty', String(v.penaltyReceivable)]]
        : []),
      ['Assets', 'HP receivable (total outstanding)', report.receivable_total],
      ['Assets', 'Total assets', String(v.totalAssets)],
      ['Funded by', 'Capital introduced', report.capital_in],
      ['Funded by', 'Capital withdrawn', report.capital_out],
      ['Funded by', 'Capital (net)', report.capital_net],
      ['Funded by', 'Interest earned to date', report.interest_earned],
      ['Funded by', 'Other income to date', report.other_income],
      ...(v.showFees ? [['Funded by', 'Fee income to date', String(v.feeIncome)]] : []),
      ...(v.showPenalties
        ? [['Funded by', 'Penalty income to date', String(v.penaltyIncome)]]
        : []),
      ['Funded by', 'Expenses to date', report.expenses],
      ['Funded by', 'Bad debt written off', report.bad_debt_written_off],
      ['Funded by', 'Retained earnings', String(v.retained)],
      ['Funded by', 'Down payments received', report.down_payments_received],
      ['Funded by', 'Unearned interest (in receivables)', report.unearned_interest],
      ['Funded by', 'Total funded', String(v.totalFunded)],
      ['Funded by', 'Unreconciled difference', String(v.difference)],
    ],
  )
}

function exportPdf(report: BalanceSheetReport, v: SheetView) {
  downloadStatementPdf({
    filename: `Balance_Sheet_${report.as_of}.pdf`,
    title: 'Balance Sheet',
    subtitle: `As of ${fmtDate(report.as_of)}  ·  ${report.open_loans} open finances`,
    sections: [
      {
        heading: 'ASSETS',
        lines: [
          { label: 'Cash in hand', value: pdfINR(v.cash) },
          { label: 'HP receivable — principal', value: pdfINR(v.receivablePrincipal), indent: true },
          { label: 'HP receivable — unearned interest', value: pdfINR(report.unearned_interest), indent: true },
          ...(v.showPenalties
            ? [{ label: 'HP receivable — penalty', value: pdfINR(v.penaltyReceivable), indent: true }]
            : []),
          { label: 'HP receivable (total outstanding)', value: pdfINR(report.receivable_total) },
          { label: 'TOTAL ASSETS', value: pdfINR(v.totalAssets), bold: true },
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
          ...(v.showFees
            ? [{ label: 'Fee income to date', value: pdfINR(v.feeIncome), indent: true }]
            : []),
          ...(v.showPenalties
            ? [{ label: 'Penalty income to date', value: pdfINR(v.penaltyIncome), indent: true }]
            : []),
          { label: 'Less: expenses to date', value: pdfINR(-Number(report.expenses)), indent: true },
          { label: 'Less: bad debt written off', value: pdfINR(-Number(report.bad_debt_written_off)), indent: true },
          { label: 'Retained earnings', value: pdfINR(v.retained) },
          { label: 'Down payments received', value: pdfINR(report.down_payments_received) },
          { label: 'Unearned interest (in receivables)', value: pdfINR(report.unearned_interest) },
          { label: 'TOTAL', value: pdfINR(v.totalFunded), bold: true },
          ...(Math.round(v.difference * 100) !== 0
            ? [{ label: 'Unreconciled difference', value: pdfINR(v.difference) }]
            : []),
        ],
      },
    ],
    note:
      'Cash in hand is the running cash-book position plus retained fees. Receivables split each ' +
      'open finance’s outstanding into principal, unearned interest, and outstanding penalty. Fee ' +
      'and penalty income are recognised when charged; toggling either off removes it from income ' +
      '(and cash, for fees) and any residual re-appears as the unreconciled difference.',
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
  const [showFees, setShowFees] = useState(true)
  const [showPenalties, setShowPenalties] = useState(true)

  const view = report ? computeView(report, showFees, showPenalties) : null

  return (
    <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
      {report && view && (
        <Stack spacing={3}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              As of {fmtDate(report.as_of)} · {report.open_loans} open finances
            </Typography>
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={() => exportCsv(report, view)}
            >
              Export CSV
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<PictureAsPdfOutlinedIcon />}
              onClick={() => exportPdf(report, view)}
            >
              Download PDF
            </Btn>
          </Stack>

          <ReportToggleBar>
            <ReportToggle label="Recognise fee income" checked={showFees} onChange={setShowFees} />
            <ReportToggle
              label="Recognise penalty income"
              checked={showPenalties}
              onChange={setShowPenalties}
            />
          </ReportToggleBar>

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
                      value={String(view.cash)}
                      color={view.cash < 0 ? 'error.main' : undefined}
                    />
                    <Line label="HP receivable — principal" value={String(view.receivablePrincipal)} indent />
                    <Line label="HP receivable — unearned interest" value={report.unearned_interest} indent />
                    {showPenalties && (
                      <Line
                        label="HP receivable — penalty"
                        value={String(view.penaltyReceivable)}
                        indent
                      />
                    )}
                    <Line label="HP receivable (total outstanding)" value={report.receivable_total} />
                    <Line label="TOTAL ASSETS" value={String(view.totalAssets)} bold />
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
                    {showFees && (
                      <Line label="Fee income to date" value={String(view.feeIncome)} indent />
                    )}
                    {showPenalties && (
                      <Line label="Penalty income to date" value={String(view.penaltyIncome)} indent />
                    )}
                    <Line label="Less: expenses to date" value={neg(report.expenses)} indent />
                    <Line label="Less: bad debt written off" value={neg(report.bad_debt_written_off)} indent />
                    <Line label="Retained earnings" value={String(view.retained)} />
                    <Line label="Down payments received" value={report.down_payments_received} />
                    <Line label="Unearned interest (in receivables)" value={report.unearned_interest} />
                    <Line label="TOTAL" value={String(view.totalFunded)} bold />
                    {Math.round(view.difference * 100) !== 0 && (
                      <Line
                        label="Unreconciled difference"
                        value={String(view.difference)}
                        color="warning.main"
                      />
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 900 }}>
            Cash in hand is the running cash-book position plus retained fees. Receivables split each
            open finance&apos;s outstanding into principal, unearned interest, and outstanding
            penalty. Retained earnings = interest + other income + fee income + penalty income −
            expenses − bad-debt principal written off. Fees and penalties are recognised when
            charged; use the switches above to drop either — the amount then leaves income (and
            cash, for fees) and any residual re-appears as the unreconciled difference. If cash in
            hand looks too negative, record your opening capital under Reports → Capital &amp;
            Expenses.
          </Typography>
        </Stack>
      )}
    </AsyncSection>
  )
}
