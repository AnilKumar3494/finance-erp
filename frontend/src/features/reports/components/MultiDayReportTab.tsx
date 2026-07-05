import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'

import { useDayReport } from '@/api/queries/reports'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { DayLedgerTable, PositionNote } from './DayLedgerTable'
import { printDayReport } from '../dayReportPrint'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

// Mirrors the backend's day-report window cap.
const MAX_RANGE_DAYS = 92

/**
 * Multi-Day Report — a stacked cash book over a date range, one ledger per
 * active day with balances rolling from section to section.
 */
export function MultiDayReportTab() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().subtract(6, 'day'))
  const [to, setTo] = useState<Dayjs>(() => dayjs())

  const rangeError =
    to.isBefore(from, 'day')
      ? 'The end date must be on or after the start date.'
      : to.diff(from, 'day') > MAX_RANGE_DAYS
        ? `Ranges are limited to ${MAX_RANGE_DAYS} days.`
        : null

  const query = useDayReport(iso(from), iso(to), !rangeError)
  const report = query.data

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
      >
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="mdr-from">From</FieldLabel>
          <DatePicker
            value={from}
            onChange={(d) => d && setFrom(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'mdr-from', size: 'small', fullWidth: true } }}
          />
        </Box>
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="mdr-to">To</FieldLabel>
          <DatePicker
            value={to}
            onChange={(d) => d && setTo(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'mdr-to', size: 'small', fullWidth: true } }}
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

      {rangeError && <ErrorBanner message={rangeError} />}

      {!rangeError && (
        <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
          {report && (
            <Stack spacing={3}>
              <Box>
                <Box sx={KPI_GRID_SX}>
                  <KpiCard
                    label="Receipts"
                    value={inr(report.total_receipts)}
                    hint={`EMI ${inr(report.total_emi_collection)} · Down ${inr(report.total_down_payments)}`}
                    accent="success.main"
                  />
                  <KpiCard
                    label="Disbursed"
                    value={inr(report.total_payments)}
                    accent="error.main"
                  />
                  <KpiCard label="Opening position" value={inr(report.opening_balance)} />
                  <KpiCard label="Closing position" value={inr(report.closing_balance)} />
                </Box>
                <PositionNote />
              </Box>

              {report.days.length === 0 ? (
                <Card>
                  <Typography variant="h3">No activity</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    No receipts or disbursements were recorded in this range.
                  </Typography>
                </Card>
              ) : (
                report.days.map((day) => (
                  <Box key={day.date}>
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{ mb: 1, alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}
                    >
                      <Typography variant="h3">{fmtDate(day.date)}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Receipts {inr(day.total_receipts)} · Disbursed{' '}
                        {inr(day.total_payments)} · Closing {inr(day.closing_balance)}
                      </Typography>
                    </Stack>
                    <DayLedgerTable day={day} />
                  </Box>
                ))
              )}
            </Stack>
          )}
        </AsyncSection>
      )}
    </Stack>
  )
}
