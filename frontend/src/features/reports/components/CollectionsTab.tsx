import { useState } from 'react'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { useCollectionReport, type CollectionEntry } from '@/api/queries/reports'
import { Card, Input } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { fmtMonthShort, money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { MiniBarChart } from './MiniBarChart'

type Period = 'daily' | 'monthly'

const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
] as const

export function CollectionsTab() {
  const [period, setPeriod] = useState<Period>('daily')
  const [days, setDays] = useState<number>(30)
  const report = useCollectionReport(period, days)

  const labelFor = (e: CollectionEntry) =>
    period === 'daily' ? fmtDate(e.date) : fmtMonthShort(e.date)

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ minWidth: 160 }}>
          <Input
            select
            id="coll-period"
            label="Group by"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <MenuItem value="daily">Daily</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
          </Input>
        </Box>
        <Box sx={{ minWidth: 160 }}>
          <Input
            select
            id="coll-window"
            label="Window"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((w) => (
              <MenuItem key={w.value} value={String(w.value)}>
                {w.label}
              </MenuItem>
            ))}
          </Input>
        </Box>
      </Stack>

      <AsyncSection isLoading={report.isLoading} isError={report.isError} error={report.error}>
        {report.data && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard
                label="Collected"
                value={fmtINR(money(report.data.total_collected))}
                accent="success.main"
              />
              <KpiCard label="Transactions" value={String(report.data.total_transactions)} />
            </Box>

            {report.data.entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No collections in this window.
              </Typography>
            ) : (
              <>
                <Card>
                  <Typography variant="caption" color="text.secondary">
                    Collected per {period === 'daily' ? 'day' : 'month'}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {/* Backend returns newest-first; chart reads left→right oldest-first. */}
                    <MiniBarChart
                      data={[...report.data.entries].reverse().map((e) => ({
                        label: labelFor(e),
                        value: money(e.total_amount),
                      }))}
                      formatValue={(n) => fmtINR(n)}
                      barColor="success.main"
                    />
                  </Box>
                </Card>

                <Card sx={{ p: 0, overflow: 'hidden' }}>
                  <TableContainer>
                    <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>
                            {period === 'daily' ? 'Date' : 'Month'}
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Cash</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">GPay</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">PhonePe</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Bank</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Other</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Total</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.data.entries.map((e) => (
                          <TableRow key={e.date}>
                            <TableCell>{labelFor(e)}</TableCell>
                            <TableCell align="right">{e.transaction_count}</TableCell>
                            <TableCell align="right">{fmtINR(money(e.cash))}</TableCell>
                            <TableCell align="right">{fmtINR(money(e.gpay))}</TableCell>
                            <TableCell align="right">{fmtINR(money(e.phonepe))}</TableCell>
                            <TableCell align="right">{fmtINR(money(e.bank_transfer))}</TableCell>
                            <TableCell align="right">{fmtINR(money(e.other))}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {fmtINR(money(e.total_amount))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </>
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
