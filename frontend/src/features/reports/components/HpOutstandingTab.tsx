import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import MenuItem from '@mui/material/MenuItem'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useHpOutstanding, type HpOutstandingRow } from '@/api/queries/reports'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { VirtualReportTable, type VirtualColumn } from './VirtualReportTable'
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

type Field =
  | 'hp'
  | 'customer'
  | 'branch'
  | 'status'
  | 'principal'
  | 'payable'
  | 'collected'
  | 'outstanding'

const ACCESSORS: Partial<Record<Field, (r: HpOutstandingRow) => string | number | null>> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  branch: (r) => r.branch_point,
  status: (r) => r.status,
  principal: (r) => Number(r.principal),
  payable: (r) => Number(r.payable),
  collected: (r) => Number(r.collected),
  outstanding: (r) => Number(r.outstanding),
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  AWAITING_CLOSURE: 'Awaiting closure',
  BAD_DEBT_PROPOSED: 'Bad debt proposed',
}

/**
 * HP Outstanding — the as-of-now ledger position of every open finance:
 * payable, collected, and outstanding per loan, with portfolio totals.
 */
export function HpOutstandingTab() {
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  const query = useHpOutstanding(!invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({
    sort_by: 'outstanding',
    sort_order: 'desc',
  })
  const onSort = (field: Field, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))

  // Branch points (customer line/place) present in the current data set.
  const branchOptions = useMemo(
    () =>
      [...new Set((report?.results ?? []).map((r) => r.branch_point).filter(Boolean))].sort() as string[],
    [report],
  )

  const filtered = useMemo(() => {
    let rows = report?.results ?? []
    if (branch) rows = rows.filter((r) => r.branch_point === branch)
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.hp_number ?? r.loan_number).toLowerCase().includes(q),
    )
  }, [report, search, branch])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  // Footer totals track the visible (filtered) rows; the KPI cards above stay
  // portfolio-wide.
  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          principal: a.principal + Number(r.principal),
          payable: a.payable + Number(r.payable),
          collected: a.collected + Number(r.collected),
          outstanding: a.outstanding + Number(r.outstanding),
        }),
        { principal: 0, payable: 0, collected: 0, outstanding: 0 },
      ),
    [rows],
  )

  const columns: VirtualColumn<HpOutstandingRow, Field>[] = [
    {
      field: 'hp',
      label: 'HP No',
      width: '12%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.hp_number ?? r.loan_number,
    },
    {
      field: 'customer',
      label: 'Customer',
      width: '22%',
      renderCell: (r) => (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {r.customer_name}
        </Typography>
      ),
    },
    {
      field: 'branch',
      label: 'Branch point',
      width: '12%',
      renderCell: (r) => r.branch_point ?? '—',
    },
    {
      field: 'status',
      label: 'Status',
      width: '10%',
      renderCell: (r) => STATUS_LABELS[r.status] ?? r.status,
    },
    {
      field: 'principal',
      label: 'Principal',
      align: 'right',
      width: '11%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.principal),
      footer: fmtINR(sums.principal),
    },
    {
      field: 'payable',
      label: 'Payable',
      align: 'right',
      width: '11%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.payable),
      footer: fmtINR(sums.payable),
    },
    {
      field: 'collected',
      label: 'Collected',
      align: 'right',
      width: '11%',
      defaultDir: 'desc',
      cellSx: { color: 'success.main' },
      renderCell: (r) => inr(r.collected),
      footer: fmtINR(sums.collected),
      footerSx: { color: 'success.main' },
    },
    {
      field: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      width: '11%',
      defaultDir: 'desc',
      cellSx: { fontWeight: 600, color: 'error.main' },
      renderCell: (r) => inr(r.outstanding),
      footer: fmtINR(sums.outstanding),
      footerSx: { color: 'error.main' },
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      'hp_outstanding.csv',
      ['HP No', 'Customer', 'Branch point', 'Status', 'Principal', 'Payable', 'Collected', 'Outstanding'],
      rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.branch_point ?? '',
        STATUS_LABELS[r.status] ?? r.status,
        r.principal,
        r.payable,
        r.collected,
        r.outstanding,
      ]),
    )

  const exportPdf = () =>
    downloadTablePdf({
      filename: 'HP_Outstanding.pdf',
      title: 'HP Outstanding',
      subtitle: [
        `${rows.length} of ${report?.total_loans ?? rows.length} open finances`,
        branch && `Branch point: ${branch}`,
        search.trim() && `Search: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      orientation: 'landscape',
      columns: [
        { header: 'HP No', width: 0.12 },
        { header: 'Customer', width: 0.24 },
        { header: 'Branch point', width: 0.12 },
        { header: 'Status', width: 0.1 },
        { header: 'Principal', width: 0.105, align: 'right' },
        { header: 'Payable', width: 0.105, align: 'right' },
        { header: 'Collected', width: 0.105, align: 'right' },
        { header: 'Outstanding', width: 0.105, align: 'right' },
      ],
      rows: rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.branch_point ?? '—',
        STATUS_LABELS[r.status] ?? r.status,
        pdfINR(r.principal),
        pdfINR(r.payable),
        pdfINR(r.collected),
        pdfINR(r.outstanding),
      ]),
      totals: [
        'TOTAL',
        '',
        '',
        '',
        pdfINR(sums.principal),
        pdfINR(sums.payable),
        pdfINR(sums.collected),
        pdfINR(sums.outstanding),
      ],
      note: 'Totals cover the rows in this document (the filters above), not the whole portfolio.',
    })

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="hpout"
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
              <KpiCard label="Principal" value={inr(report.total_principal)} />
              <KpiCard label="Payable" value={inr(report.total_payable)} />
              <KpiCard
                label="Collected"
                value={inr(report.total_collected)}
                accent="success.main"
              />
              <KpiCard
                label="Outstanding"
                value={inr(report.total_outstanding)}
                accent="error.main"
              />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="hpo-search"
                  placeholder="Filter by customer or HP number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </Box>
              {branchOptions.length > 0 && (
                <Box sx={{ minWidth: 180 }}>
                  <Input
                    select
                    id="hpo-branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    slotProps={{
                      select: {
                        displayEmpty: true,
                        renderValue: (v) => (v ? String(v) : 'All branch points'),
                      },
                    }}
                  >
                    <MenuItem value="">All branch points</MenuItem>
                    {branchOptions.map((b) => (
                      <MenuItem key={b} value={b}>
                        {b}
                      </MenuItem>
                    ))}
                  </Input>
                </Box>
              )}
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
              <VirtualReportTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.loan_id}
                onRowClick={(r) =>
                  navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })
                }
                sort={sort}
                onSort={onSort}
                minWidth={980}
                estimateRowHeight={40}
              />
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
