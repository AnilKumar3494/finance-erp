import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useFeeReport, type FeeRow } from '@/api/queries/reports'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtDate, fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { VirtualReportTable, type VirtualColumn } from './VirtualReportTable'
import { downloadCsv } from '../csvExport'
import { downloadTablePdf, pdfINR } from '../reportPdf'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import { EMPTY_RANGE, isoOrUndefined, rangeError, type DateRangeValue } from '@/lib/dateRange'

const inr = (s: string) => fmtINR(Number(s))

// Five tiles, not the shared four-column grid — otherwise the grand total
// orphans onto a row of its own and reads like an afterthought.
const FEE_KPI_GRID_SX = {
  ...KPI_GRID_SX,
  gridTemplateColumns: {
    xs: 'repeat(2, 1fr)',
    sm: 'repeat(3, 1fr)',
    lg: 'repeat(5, 1fr)',
  },
} as const

type Field = 'hp' | 'customer' | 'approved' | 'processing' | 'documentation' | 'dsc' | 'rto' | 'total'

const ACCESSORS: Partial<Record<Field, (r: FeeRow) => string | number | null>> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  approved: (r) => r.approval_date,
  processing: (r) => Number(r.processing_fee),
  documentation: (r) => Number(r.documentation_fee),
  dsc: (r) => Number(r.dsc_fee),
  rto: (r) => Number(r.rto_fee),
  total: (r) => Number(r.total_fee),
}

/**
 * Fees — the four one-off charges recorded on each executed finance
 * (processing, documentation, DSC, RTO), per finance and in total.
 *
 * These are what was AGREED on the finance, not what has been receipted:
 * nothing in the schema records a fee payment separately from the loan row.
 */
export function FeesTab() {
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  const query = useFeeReport(!invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({ sort_by: 'total', sort_order: 'desc' })
  const onSort = (field: Field, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))

  const filtered = useMemo(() => {
    const rows = report?.results ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        r.customer_mobile.includes(q) ||
        (r.hp_number ?? r.loan_number).toLowerCase().includes(q),
    )
  }, [report, search])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          processing: a.processing + Number(r.processing_fee),
          documentation: a.documentation + Number(r.documentation_fee),
          dsc: a.dsc + Number(r.dsc_fee),
          rto: a.rto + Number(r.rto_fee),
          total: a.total + Number(r.total_fee),
        }),
        { processing: 0, documentation: 0, dsc: 0, rto: 0, total: 0 },
      ),
    [rows],
  )

  const columns: VirtualColumn<FeeRow, Field>[] = [
    {
      field: 'hp',
      label: 'HP No',
      width: '11%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.hp_number ?? r.loan_number,
    },
    {
      field: 'customer',
      label: 'Name',
      width: '21%',
      renderCell: (r) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {r.customer_name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'var(--font-mono)' }}
          >
            {r.customer_mobile}
          </Typography>
        </>
      ),
    },
    {
      field: 'approved',
      label: 'Approved',
      width: '11%',
      defaultDir: 'desc',
      renderCell: (r) => (r.approval_date ? fmtDate(r.approval_date) : '—'),
    },
    {
      field: 'processing',
      label: 'Processing',
      align: 'right',
      width: '11%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.processing_fee),
      footer: fmtINR(sums.processing),
    },
    {
      field: 'documentation',
      label: 'Documentation',
      align: 'right',
      width: '12%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.documentation_fee),
      footer: fmtINR(sums.documentation),
    },
    {
      field: 'dsc',
      label: 'DSC',
      align: 'right',
      width: '8%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.dsc_fee),
      footer: fmtINR(sums.dsc),
    },
    {
      field: 'rto',
      label: 'RTO',
      align: 'right',
      width: '8%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.rto_fee),
      footer: fmtINR(sums.rto),
    },
    {
      field: 'total',
      label: 'Total',
      align: 'right',
      width: '18%',
      defaultDir: 'desc',
      cellSx: { fontWeight: 600 },
      renderCell: (r) => inr(r.total_fee),
      footer: fmtINR(sums.total),
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      'fees.csv',
      [
        'HP No',
        'Customer',
        'Mobile',
        'Approved',
        'Processing fee',
        'Documentation fee',
        'DSC fee',
        'RTO fee',
        'Total fee',
      ],
      [
        ...rows.map((r) => [
          r.hp_number ?? r.loan_number,
          r.customer_name,
          r.customer_mobile,
          r.approval_date,
          r.processing_fee,
          r.documentation_fee,
          r.dsc_fee,
          r.rto_fee,
          r.total_fee,
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          sums.processing.toFixed(2),
          sums.documentation.toFixed(2),
          sums.dsc.toFixed(2),
          sums.rto.toFixed(2),
          sums.total.toFixed(2),
        ],
      ],
    )

  const exportPdf = () =>
    downloadTablePdf({
      filename: 'Fees.pdf',
      title: 'Fees',
      subtitle: [
        `${rows.length} of ${report?.total_loans ?? rows.length} finances`,
        search.trim() && `Search: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      orientation: 'landscape',
      columns: [
        { header: 'HP No', width: 0.11 },
        { header: 'Customer', width: 0.21 },
        { header: 'Mobile', width: 0.1 },
        { header: 'Approved', width: 0.1 },
        { header: 'Processing', width: 0.1, align: 'right' },
        { header: 'Documentation', width: 0.12, align: 'right' },
        { header: 'DSC', width: 0.08, align: 'right' },
        { header: 'RTO', width: 0.08, align: 'right' },
        { header: 'Total', width: 0.1, align: 'right' },
      ],
      rows: rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.customer_mobile,
        r.approval_date ? fmtDate(r.approval_date) : '—',
        pdfINR(r.processing_fee),
        pdfINR(r.documentation_fee),
        pdfINR(r.dsc_fee),
        pdfINR(r.rto_fee),
        pdfINR(r.total_fee),
      ]),
      totals: [
        'TOTAL',
        '',
        '',
        '',
        pdfINR(sums.processing),
        pdfINR(sums.documentation),
        pdfINR(sums.dsc),
        pdfINR(sums.rto),
        pdfINR(sums.total),
      ],
      note: 'Fees as agreed on each finance, not fees receipted. Totals cover the rows in this document (the filters above), not the whole window.',
    })

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="fees"
        value={range}
        onChange={setRange}
        fromLabel="Approved from"
        toLabel="Approved to"
      />

      {invalidRange && <ErrorBanner message={invalidRange} />}

      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <>
            <Box sx={FEE_KPI_GRID_SX}>
              <KpiCard label="Processing fees" value={inr(report.total_processing_fee)} />
              <KpiCard label="Documentation fees" value={inr(report.total_documentation_fee)} />
              <KpiCard label="DSC fees" value={inr(report.total_dsc_fee)} />
              <KpiCard label="RTO fees" value={inr(report.total_rto_fee)} />
              <KpiCard
                label="All fees"
                value={inr(report.total_fees)}
                hint={`${report.total_loans} finances`}
                accent="var(--accent)"
              />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="fees-search"
                  placeholder="Filter by customer, mobile, or HP number…"
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
                No finances match this filter.
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
                minWidth={900}
                estimateRowHeight={52}
              />
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
