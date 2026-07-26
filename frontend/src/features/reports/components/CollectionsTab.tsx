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
import { Card, ErrorBanner, Input } from '@/components/primitives'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtDate, fmtINR } from '@/lib/format'
import { fmtMonthShort, money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import {
  EMPTY_RANGE,
  isoOrUndefined,
  rangeError,
  type DateRangeValue,
} from '@/lib/dateRange'

type Period = 'daily' | 'monthly'

type CollField = 'date' | 'txns' | 'cash' | 'gpay' | 'phonepe' | 'bank' | 'other' | 'total'

const COLL_ACCESSORS: Partial<Record<CollField, (e: CollectionEntry) => string | number | null>> = {
  date: (e) => e.date,
  txns: (e) => e.transaction_count,
  cash: (e) => money(e.cash),
  gpay: (e) => money(e.gpay),
  phonepe: (e) => money(e.phonepe),
  bank: (e) => money(e.bank_transfer),
  other: (e) => money(e.other),
  total: (e) => money(e.total_amount),
}

const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
] as const

export function CollectionsTab() {
  const [period, setPeriod] = useState<Period>('daily')
  const [days, setDays] = useState<number>(30)
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  // An explicit window supersedes the rolling day count on the server, so the
  // dropdown is disabled rather than left showing a figure that isn't in play.
  const hasRange = Boolean(range.from || range.to)
  const report = useCollectionReport(period, days, !invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })

  const [sort, setSort] = useState<SortState<CollField>>({ sort_by: 'date', sort_order: 'desc' })
  const onSort = (field: CollField, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))
  const rows = useClientSort(report.data?.entries ?? [], sort.sort_by, sort.sort_order, COLL_ACCESSORS)

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
            label={hasRange ? 'Window (using dates)' : 'Window'}
            value={String(days)}
            disabled={hasRange}
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

      <DateRangeFilter idPrefix="coll" value={range} onChange={setRange} />

      {invalidRange && <ErrorBanner message={invalidRange} />}

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
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                    <TableHead>
                      <TableRow>
                        <SortableTh field="date" label={period === 'daily' ? 'Date' : 'Month'} activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="txns" label="Txns" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="cash" label="Cash" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="gpay" label="GPay" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="phonepe" label="PhonePe" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="bank" label="Bank" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="other" label="Other" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="total" label="Total" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((e) => (
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
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
