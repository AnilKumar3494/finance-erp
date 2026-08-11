import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'

import { useDayReport } from '@/api/queries/reports'
import { Btn, Card } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { fmtINR } from '@/lib/format'
import { onlyValidDate } from '@/lib/dateRange'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { DayLedgerTable, PositionNote } from './DayLedgerTable'
import { printDayReport } from '../dayReportPrint'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

/**
 * Day Report — a single day's cash book: every receipt and disbursement on
 * the chosen date, with the rolling position carried in from all history.
 */
export function DayReportTab() {
  const [day, setDay] = useState<Dayjs>(() => dayjs())
  const query = useDayReport(iso(day), iso(day))
  const report = query.data
  const section = report?.days[0]

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
      >
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="day-report-date">Date</FieldLabel>
          <DatePicker
            value={day}
            onChange={onlyValidDate(setDay)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{
              textField: { id: 'day-report-date', size: 'small', fullWidth: true },
            }}
          />
        </Box>
        <Btn
          variant="ghost"
          startIcon={<PrintOutlinedIcon />}
          disabled={!report}
          onClick={() => report && printDayReport(report)}
        >
          Print
        </Btn>
      </Stack>

      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <Stack spacing={3}>
            <Box>
              <Box sx={KPI_GRID_SX}>
                <KpiCard
                  label="Receipts"
                  value={inr(report.total_receipts)}
                  hint={`EMI ${inr(report.total_emi_collection)} · TA ${inr(report.total_ta_collection)} · Down ${inr(report.total_down_payments)} · Capital+income ${fmtINR(Number(report.total_capital_in) + Number(report.total_other_income))}`}
                  accent="success.main"
                />
                <KpiCard
                  label="Payments out"
                  value={inr(report.total_payments)}
                  hint={`Financed ${fmtINR(Number(report.total_payments) - Number(report.total_expenses) - Number(report.total_capital_out))} · Expenses+withdrawals ${fmtINR(Number(report.total_expenses) + Number(report.total_capital_out))}`}
                  accent="error.main"
                />
                <KpiCard label="Opening position" value={inr(report.opening_balance)} />
                <KpiCard label="Closing position" value={inr(report.closing_balance)} />
              </Box>
              <PositionNote />
            </Box>

            {report.total_receipts !== '0.00' && (
              <Typography variant="body2" color="text.secondary">
                Modes: Cash {inr(report.cash)} · GPay {inr(report.gpay)} · PhonePe{' '}
                {inr(report.phonepe)} · Bank {inr(report.bank_transfer)} · Other{' '}
                {inr(report.other)}
              </Typography>
            )}

            {section ? (
              <DayLedgerTable day={section} />
            ) : (
              <Card>
                <Typography variant="h3">No activity</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No receipts or disbursements were recorded on this date.
                </Typography>
              </Card>
            )}
          </Stack>
        )}
      </AsyncSection>
    </Stack>
  )
}
