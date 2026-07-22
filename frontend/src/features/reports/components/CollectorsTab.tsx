import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import { useCollectionsByCollector } from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

/**
 * Collections by collector over a date range — the twin of iFinance's
 * date-ranged Collection Report, aggregated per collecting user.
 */
export function CollectorsTab() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().startOf('month'))
  const [to, setTo] = useState<Dayjs>(() => dayjs())
  const query = useCollectionsByCollector(iso(from), iso(to))
  const report = query.data

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
      >
        <Box sx={{ minWidth: 180 }}>
          <FieldLabel htmlFor="collectors-from">From</FieldLabel>
          <DatePicker
            value={from}
            onChange={(d) => d && setFrom(d)}
            format="DD MMM YYYY"
            maxDate={to}
            slotProps={{
              textField: { id: 'collectors-from', size: 'small', fullWidth: true },
            }}
          />
        </Box>
        <Box sx={{ minWidth: 180 }}>
          <FieldLabel htmlFor="collectors-to">To</FieldLabel>
          <DatePicker
            value={to}
            onChange={(d) => d && setTo(d)}
            format="DD MMM YYYY"
            minDate={from}
            maxDate={dayjs()}
            slotProps={{
              textField: { id: 'collectors-to', size: 'small', fullWidth: true },
            }}
          />
        </Box>
      </Stack>

      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <Stack spacing={3}>
            <Box sx={KPI_GRID_SX}>
              <KpiCard
                label="Collected in period"
                value={inr(report.total_collected)}
                hint={`${report.total_transactions} receipts across ${report.results.length} collectors`}
                accent="success.main"
              />
              <KpiCard
                label="TA collected"
                value={inr(report.total_ta)}
                hint="Travelling allowance, on top of EMIs"
              />
              <KpiCard label="Collectors active" value={String(report.results.length)} />
            </Box>

            {report.results.length === 0 ? (
              <Card>
                <Typography variant="body2" color="text.secondary">
                  No collections recorded in this period.
                </Typography>
              </Card>
            ) : (
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Collector</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Receipts</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Collected</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>TA</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Cash</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>GPay</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>PhonePe</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Bank</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                      {report.results.map((r) => (
                        <TableRow key={r.collector_id}>
                          <TableCell sx={{ textTransform: 'capitalize' }}>
                            {r.collector_name}
                            {!r.is_active && (
                              <Typography component="span" variant="caption" color="text.secondary">
                                {' '}· former
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">{r.transaction_count}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>
                            {inr(r.total_amount)}
                          </TableCell>
                          <TableCell align="right">{inr(r.ta_amount)}</TableCell>
                          <TableCell align="right">{inr(r.cash)}</TableCell>
                          <TableCell align="right">{inr(r.gpay)}</TableCell>
                          <TableCell align="right">{inr(r.phonepe)}</TableCell>
                          <TableCell align="right">{inr(r.bank_transfer)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {report.total_transactions}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                          {inr(report.total_collected)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {inr(report.total_ta)}
                        </TableCell>
                        <TableCell colSpan={4} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}
          </Stack>
        )}
      </AsyncSection>
    </Stack>
  )
}
