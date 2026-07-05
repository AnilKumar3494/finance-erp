import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { useNavigate } from '@tanstack/react-router'

import { useReceivedInterest, type ReceivedInterestRow } from '@/api/queries/reports'
import { Card, ErrorBanner } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

type RIField = 'hp' | 'customer' | 'txns' | 'paid' | 'interest'

const RI_ACCESSORS: Partial<
  Record<RIField, (r: ReceivedInterestRow) => string | number | null>
> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  txns: (r) => r.transaction_count,
  paid: (r) => Number(r.amount_paid),
  interest: (r) => Number(r.received_interest),
}

/**
 * Received Interest — per-loan interest earned on EMI collections inside a
 * date window. Loans are flat-rate, so each collected rupee carries the
 * loan's fixed interest share; the backend does the math.
 */
export function ReceivedInterestTab() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().subtract(29, 'day'))
  const [to, setTo] = useState<Dayjs>(() => dayjs())
  const navigate = useNavigate()

  const rangeError = to.isBefore(from, 'day')
    ? 'The end date must be on or after the start date.'
    : null

  const query = useReceivedInterest(iso(from), iso(to), !rangeError)
  const report = query.data

  const [sort, setSort] = useState<SortState<RIField>>({
    sort_by: 'interest',
    sort_order: 'desc',
  })
  const onSort = (field: RIField, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))
  const rows = useClientSort(
    report?.results ?? [],
    sort.sort_by,
    sort.sort_order,
    RI_ACCESSORS,
  )

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
      >
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="ri-from">From</FieldLabel>
          <DatePicker
            value={from}
            onChange={(d) => d && setFrom(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'ri-from', size: 'small', fullWidth: true } }}
          />
        </Box>
        <Box sx={{ minWidth: 190 }}>
          <FieldLabel htmlFor="ri-to">To</FieldLabel>
          <DatePicker
            value={to}
            onChange={(d) => d && setTo(d)}
            format="DD MMM YYYY"
            maxDate={dayjs()}
            slotProps={{ textField: { id: 'ri-to', size: 'small', fullWidth: true } }}
          />
        </Box>
      </Stack>

      {rangeError && <ErrorBanner message={rangeError} />}

      {!rangeError && (
        <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
          {report && (
            <>
              <Box sx={KPI_GRID_SX}>
                <KpiCard
                  label="Collected in period"
                  value={inr(report.total_amount_paid)}
                  hint={`${report.results.length} loan${report.results.length === 1 ? '' : 's'} paid`}
                />
                <KpiCard
                  label="Interest earned"
                  value={inr(report.total_received_interest)}
                  accent="success.main"
                />
              </Box>

              {report.results.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No EMI collections in this window.
                </Typography>
              ) : (
                <Card sx={{ p: 0, overflow: 'hidden' }}>
                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table
                      size="small"
                      sx={{ minWidth: 720, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}
                    >
                      <TableHead>
                        <TableRow>
                          <SortableTh field="hp" label="HP No" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                          <SortableTh field="customer" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                          <SortableTh field="txns" label="Payments" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                          <SortableTh field="paid" label="Amount paid" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                          <SortableTh field="interest" label="Received interest" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow
                            key={r.loan_id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() =>
                              navigate({
                                to: '/finances/$loanId/collections',
                                params: { loanId: r.loan_id },
                              })
                            }
                          >
                            <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                              {r.hp_number ?? r.loan_number}
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, color: 'text.primary' }}
                              >
                                {r.customer_name}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{r.transaction_count}</TableCell>
                            <TableCell align="right">{inr(r.amount_paid)}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ fontWeight: 600, color: 'success.main' }}
                            >
                              {inr(r.received_interest)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>TOTAL</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {inr(report.total_amount_paid)}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontWeight: 700, color: 'success.main' }}
                          >
                            {inr(report.total_received_interest)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              )}
            </>
          )}
        </AsyncSection>
      )}
    </Stack>
  )
}
