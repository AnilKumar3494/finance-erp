import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined'

import {
  downloadCustomerReportCsv,
  useCustomerReport,
  type CustomerReportSortField,
} from '@/api/queries/reports'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { PagerBar } from '@/components/PagerBar'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, type SortOrder, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import { mapReportError, money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import {
  EMPTY_RANGE,
  isoOrUndefined,
  rangeError,
  type DateRangeValue,
} from '@/lib/dateRange'

const PAGE_SIZE = 50

const CUST_SORT_OPTIONS: readonly SortOption<CustomerReportSortField>[] = [
  { value: 'outstanding:desc', label: 'Outstanding (high → low)', sort_by: 'outstanding', sort_order: 'desc' },
  { value: 'outstanding:asc', label: 'Outstanding (low → high)', sort_by: 'outstanding', sort_order: 'asc' },
  { value: 'full_name:asc', label: 'Name (A → Z)', sort_by: 'full_name', sort_order: 'asc' },
  { value: 'full_name:desc', label: 'Name (Z → A)', sort_by: 'full_name', sort_order: 'desc' },
  { value: 'active_loans:desc', label: 'Active loans (most)', sort_by: 'active_loans', sort_order: 'desc' },
  { value: 'principal:desc', label: 'Principal (high → low)', sort_by: 'principal', sort_order: 'desc' },
  { value: 'paid:desc', label: 'Paid (high → low)', sort_by: 'paid', sort_order: 'desc' },
]

export function CustomersReportTab() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState<CustomerReportSortField>>({
    sort_by: 'outstanding',
    sort_order: 'desc',
  })
  // Changing the sort jumps back to page 1 so the user sees the top of the new
  // ordering rather than a stale middle page.
  const onSort = (field: CustomerReportSortField, defaultDir: SortOrder) => {
    setSort((s) => toggleSort(s, field, defaultDir))
    setPage(1)
  }
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  // A narrower window has fewer pages, so stay on page 1 rather than stranding
  // the pager past the end of the new result set.
  const onRange = (next: DateRangeValue) => {
    setRange(next)
    setPage(1)
  }
  const report = useCustomerReport(page, PAGE_SIZE, !invalidRange, sort, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const total = report.data?.total_customers ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1

  const pager = (edge: 'top' | 'bottom') =>
    total > 0 ? (
      <PagerBar
        edge={edge}
        page={page}
        totalPages={totalPages}
        label={`${total} customer${total === 1 ? '' : 's'}`}
        onPage={setPage}
      />
    ) : null

  const onExport = async () => {
    setExportError(null)
    setExporting(true)
    try {
      await downloadCustomerReportCsv()
    } catch (e) {
      setExportError(mapReportError(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="custrep"
        value={range}
        onChange={onRange}
        fromLabel="Financed from"
        toLabel="Financed to"
      />

      {invalidRange && <ErrorBanner message={invalidRange} />}

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          Per-customer outstanding across open loans.
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            <SortSelect
              options={CUST_SORT_OPTIONS}
              sort_by={sort.sort_by}
              sort_order={sort.sort_order}
              onChange={(next) => {
                setSort(next)
                setPage(1)
              }}
            />
          </Box>
          <Btn
            variant="ghost"
            size="sm"
            startIcon={<DownloadIcon />}
            onClick={onExport}
            loading={exporting}
          >
            Export CSV
          </Btn>
        </Stack>
      </Stack>

      {exportError && <ErrorBanner message={exportError} />}

      <AsyncSection isLoading={report.isLoading} isError={report.isError} error={report.error}>
        {report.data && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard label="Customers" value={String(report.data.total_customers)} />
              <KpiCard
                label="With active loans"
                value={String(report.data.customers_with_active_loans)}
              />
            </Box>

            {report.data.results.length > 0 && pager('top')}

            {report.data.results.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No customers to report.
              </Typography>
            ) : (
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                    <TableHead>
                      <TableRow>
                        <SortableTh field="full_name" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="mobile_number" label="Mobile" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="active_loans" label="Active loans" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="principal" label="Principal" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="paid" label="Paid" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="outstanding" label="Outstanding" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.data.results.map((c) => (
                        <TableRow key={c.customer_id}>
                          <TableCell>{c.customer_name}</TableCell>
                          <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                            {c.mobile_number}
                          </TableCell>
                          <TableCell align="right">{c.active_loans}</TableCell>
                          <TableCell align="right">{fmtINR(money(c.total_principal))}</TableCell>
                          <TableCell align="right">{fmtINR(money(c.total_paid))}</TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontWeight: 600,
                              color: money(c.total_outstanding) > 0 ? 'error.main' : undefined,
                            }}
                          >
                            {fmtINR(money(c.total_outstanding))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}

            {report.data.results.length > 0 && pager('bottom')}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
