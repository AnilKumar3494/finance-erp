import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableRow from '@mui/material/TableRow'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'

import { usePnl } from '@/api/queries/reports'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { downloadCsv } from '../csvExport'
import { downloadStatementPdf, pdfINR } from '../reportPdf'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

// Mirrors the backend's /reports/pnl window cap.
const MAX_RANGE_DAYS = 366

/**
 * Profit & Loss — earnings for a period. Income is the interest share of the
 * window's EMI collections plus recorded other income; expenses come from the
 * Capital & Expenses ledger, broken down by category. Capital movements and
 * down payments are balance-sheet items and deliberately absent here.
 */
export function PnlTab() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().startOf('month'))
  const [to, setTo] = useState<Dayjs>(() => dayjs())

  const rangeError = to.isBefore(from, 'day')
    ? 'The end date must be on or after the start date.'
    : to.diff(from, 'day') > MAX_RANGE_DAYS
      ? `Ranges are limited to ${MAX_RANGE_DAYS} days.`
      : null

  const query = usePnl(iso(from), iso(to), !rangeError)
  const report = query.data

  const exportCsv = () =>
    report &&
    downloadCsv(
      `profit_and_loss_${report.date1}_${report.date2}.csv`,
      ['Section', 'Item', 'Amount'],
      [
        ['Income', 'Interest earned on collections', report.interest_received],
        ['Income', 'Other income', report.other_income],
        ['Income', 'Total income', report.total_income],
        ...report.expenses_by_category.map(
          (e) => ['Expenses', e.category ?? 'Uncategorised', e.amount],
        ),
        ['Expenses', 'Total expenses', report.total_expenses],
        ['Net profit', 'Net profit for the period', report.net_profit],
      ],
    )

  const exportPdf = () =>
    report &&
    downloadStatementPdf({
      filename: `Profit_and_Loss_${report.date1}_${report.date2}.pdf`,
      title: 'Profit & Loss',
      subtitle: `${fmtDate(report.date1)} — ${fmtDate(report.date2)}`,
      sections: [
        {
          heading: 'INCOME',
          lines: [
            { label: 'Interest earned on collections', value: pdfINR(report.interest_received), indent: true },
            { label: 'Other income', value: pdfINR(report.other_income), indent: true },
            { label: 'Total income', value: pdfINR(report.total_income), bold: true },
          ],
        },
        {
          heading: 'EXPENSES',
          lines: [
            ...(report.expenses_by_category.length === 0
              ? [{ label: 'No expenses recorded in this period.', value: '', indent: true }]
              : report.expenses_by_category.map((e) => ({
                  label: e.category ?? 'Uncategorised',
                  value: pdfINR(e.amount),
                  indent: true,
                }))),
            { label: 'Total expenses', value: pdfINR(report.total_expenses), bold: true },
          ],
        },
        {
          heading: 'NET PROFIT',
          lines: [{ label: 'Net profit for the period', value: pdfINR(report.net_profit), bold: true }],
        },
      ],
      note:
        'Interest earned is the flat-rate interest share of EMI collections dated in this period. ' +
        'Other income and expenses come from the Capital & Expenses ledger. Capital in/out and down ' +
        'payments are balance-sheet items, not earnings.',
    })

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}>
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="pnl-from">From</FieldLabel>
          <DatePicker
            value={from}
            onChange={(d) => d && setFrom(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'pnl-from', size: 'small', fullWidth: true } }}
          />
        </Box>
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="pnl-to">To</FieldLabel>
          <DatePicker
            value={to}
            onChange={(d) => d && setTo(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'pnl-to', size: 'small', fullWidth: true } }}
          />
        </Box>
        <Btn
          variant="ghost"
          startIcon={<FileDownloadOutlinedIcon />}
          disabled={!report}
          onClick={exportCsv}
        >
          Export CSV
        </Btn>
        <Btn
          variant="ghost"
          startIcon={<PictureAsPdfOutlinedIcon />}
          disabled={!report}
          onClick={exportPdf}
        >
          Download PDF
        </Btn>
      </Stack>

      {rangeError && <ErrorBanner message={rangeError} />}

      {!rangeError && (
        <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
          {report && (
            <Stack spacing={3}>
              <Box sx={KPI_GRID_SX}>
                <KpiCard
                  label="Income"
                  value={inr(report.total_income)}
                  hint={`Interest ${inr(report.interest_received)} · Other ${inr(report.other_income)}`}
                  accent="success.main"
                />
                <KpiCard label="Expenses" value={inr(report.total_expenses)} accent="error.main" />
                <KpiCard
                  label="Net profit"
                  value={inr(report.net_profit)}
                  accent={Number(report.net_profit) >= 0 ? 'success.main' : 'error.main'}
                />
                <KpiCard
                  label="Collections in period"
                  value={inr(report.collections)}
                  hint="EMI receipts the interest is earned on"
                />
              </Box>

              <Card sx={{ p: 0, overflow: 'hidden', maxWidth: 720 }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                    <TableBody>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>INCOME</TableCell>
                        <TableCell />
                      </TableRow>
                      <TableRow>
                        <TableCell>Interest earned on collections</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>
                          {inr(report.interest_received)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Other income</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>
                          {inr(report.other_income)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Total income</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>
                          {inr(report.total_income)}
                        </TableCell>
                      </TableRow>

                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>EXPENSES</TableCell>
                        <TableCell />
                      </TableRow>
                      {report.expenses_by_category.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} sx={{ color: 'text.secondary' }}>
                            No expenses recorded in this period.
                          </TableCell>
                        </TableRow>
                      ) : (
                        report.expenses_by_category.map((e, i) => (
                          <TableRow key={`${e.category ?? 'uncategorised'}-${i}`}>
                            <TableCell>{e.category ?? 'Uncategorised'}</TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>
                              {inr(e.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Total expenses</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                          {inr(report.total_expenses)}
                        </TableCell>
                      </TableRow>

                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>NET PROFIT</TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontWeight: 700,
                            color: Number(report.net_profit) >= 0 ? 'success.main' : 'error.main',
                          }}
                        >
                          {inr(report.net_profit)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>

              <Typography variant="body2" color="text.secondary">
                Interest earned is the flat-rate interest share of EMI collections dated in this
                period (the same rule as the Received Interest report). Other income and expenses
                come from entries recorded under Reports → Capital &amp; Expenses. Capital in/out
                and down payments are not earnings, so they appear on the Balance Sheet instead.
              </Typography>
            </Stack>
          )}
        </AsyncSection>
      )}
    </Stack>
  )
}
