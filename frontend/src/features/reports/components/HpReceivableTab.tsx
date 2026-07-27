import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useHpReceivable, type HpReceivableRow } from '@/api/queries/reports'
import { Btn, Card, ErrorBanner, Input } from '@/components/primitives'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { downloadCsv } from '../csvExport'
import { downloadTablePdf, pdfINR } from '../reportPdf'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import {
  EMPTY_RANGE,
  isoOrUndefined,
  rangeError,
  type DateRangeValue,
} from '@/lib/dateRange'

const inr = (s: string) => fmtINR(Number(s))

type Field = 'hp' | 'customer' | 'outstanding' | 'receivable'

const ACCESSORS: Partial<Record<Field, (r: HpReceivableRow) => string | number | null>> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  outstanding: (r) => Number(r.outstanding),
  receivable: (r) => Number(r.receivable_interest),
}

/**
 * HP Receivable — interest still to be earned per open finance: the loan's
 * flat-rate interest share applied to its outstanding balance.
 */
export function HpReceivableTab() {
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  const query = useHpReceivable(!invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({
    sort_by: 'receivable',
    sort_order: 'desc',
  })
  const onSort = (field: Field, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))

  const filtered = useMemo(() => {
    const rows = report?.results ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.hp_number ?? r.loan_number).toLowerCase().includes(q),
    )
  }, [report, search])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          outstanding: a.outstanding + Number(r.outstanding),
          receivable: a.receivable + Number(r.receivable_interest),
        }),
        { outstanding: 0, receivable: 0 },
      ),
    [rows],
  )

  const exportCsv = () =>
    downloadCsv(
      'hp_receivable_interest.csv',
      ['HP No', 'Customer', 'Outstanding', 'Receivable interest'],
      rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.outstanding,
        r.receivable_interest,
      ]),
    )

  const exportPdf = () =>
    downloadTablePdf({
      filename: 'Receivable_Interest.pdf',
      title: 'Receivable Interest',
      subtitle: [
        `${rows.length} of ${report?.total_loans ?? rows.length} open finances`,
        search.trim() && `Search: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      columns: [
        { header: 'HP No', width: 0.18 },
        { header: 'Customer', width: 0.42 },
        { header: 'Outstanding', width: 0.2, align: 'right' },
        { header: 'Receivable interest', width: 0.2, align: 'right' },
      ],
      rows: rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        pdfINR(r.outstanding),
        pdfINR(r.receivable_interest),
      ]),
      totals: ['TOTAL', '', pdfINR(sums.outstanding), pdfINR(sums.receivable)],
      note: 'Receivable interest is each finance’s outstanding balance times its flat-rate interest share. Totals cover the rows in this document.',
    })

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="hprecv"
        value={range}
        onChange={setRange}
        fromLabel="Approved from"
        toLabel="Approved to"
      />

      {invalidRange && <ErrorBanner message={invalidRange} />}

      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard label="Open finances" value={String(report.total_loans)} />
              <KpiCard label="Customers" value={String(report.total_customers)} />
              <KpiCard
                label="Outstanding"
                value={inr(report.total_outstanding)}
                accent="error.main"
              />
              <KpiCard
                label="Receivable interest"
                value={inr(report.total_receivable_interest)}
                accent="success.main"
                hint="Interest share of the outstanding balance"
              />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="hpr-search"
                  placeholder="Filter by customer or HP number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {rows.length} of {report.results.length} finances
              </Typography>
              <Btn variant="ghost" startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv}>
                Export CSV
              </Btn>
              <Btn variant="ghost" startIcon={<PictureAsPdfOutlinedIcon />} onClick={exportPdf}>
                Download PDF
              </Btn>
            </Stack>

            {rows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No open finances match this filter.
              </Typography>
            ) : (
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table
                    size="small"
                    sx={{ minWidth: 640, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}
                  >
                    <TableHead>
                      <TableRow>
                        <SortableTh field="hp" label="HP No" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="customer" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="outstanding" label="Outstanding" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="receivable" label="Receivable interest" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow
                          key={r.loan_id}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() =>
                            navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })
                          }
                        >
                          <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                            {r.hp_number ?? r.loan_number}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                              {r.customer_name}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{inr(r.outstanding)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>
                            {inr(r.receivable_interest)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>TOTAL</TableCell>
                        <TableCell />
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {fmtINR(sums.outstanding)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                          {fmtINR(sums.receivable)}
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
    </Stack>
  )
}
