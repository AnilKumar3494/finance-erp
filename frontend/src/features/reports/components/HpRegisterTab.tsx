import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useHpRegister, type HpRegisterRow } from '@/api/queries/reports'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtDate, fmtINR } from '@/lib/format'
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

type Field = 'hp' | 'customer' | 'vehicle' | 'approved' | 'principal' | 'rate' | 'tenure' | 'payable' | 'status'

const ACCESSORS: Partial<Record<Field, (r: HpRegisterRow) => string | number | null>> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  vehicle: (r) => r.vehicle_plate,
  approved: (r) => r.approval_date,
  principal: (r) => Number(r.principal),
  rate: (r) => (r.interest_rate === null ? null : Number(r.interest_rate)),
  tenure: (r) => r.tenure,
  payable: (r) => Number(r.total_payable),
  status: (r) => r.status,
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  AWAITING_CLOSURE: 'Awaiting closure',
  CLOSED: 'Closed',
  BAD_DEBT_PROPOSED: 'Bad debt proposed',
  BAD_DEBT: 'Bad debt',
}

/**
 * HP Register — the full register of executed finances (drafts excluded):
 * agreement terms, vehicle, and approval date per loan.
 */
export function HpRegisterTab() {
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  const query = useHpRegister(!invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({
    sort_by: 'approved',
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
        r.customer_mobile.includes(q) ||
        (r.vehicle_plate ?? '').toLowerCase().includes(q) ||
        (r.hp_number ?? r.loan_number).toLowerCase().includes(q),
    )
  }, [report, search])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          principal: a.principal + Number(r.principal),
          payable: a.payable + Number(r.total_payable),
        }),
        { principal: 0, payable: 0 },
      ),
    [rows],
  )

  const columns: VirtualColumn<HpRegisterRow, Field>[] = [
    {
      field: 'hp',
      label: 'HP No',
      width: '10%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.hp_number ?? r.loan_number,
    },
    {
      field: 'customer',
      label: 'Customer',
      width: '20%',
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
      field: 'vehicle',
      label: 'Vehicle',
      width: '10%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.vehicle_plate ?? '—',
    },
    {
      field: 'approved',
      label: 'Approved',
      width: '10%',
      defaultDir: 'desc',
      renderCell: (r) => (r.approval_date ? fmtDate(r.approval_date) : '—'),
    },
    {
      field: 'principal',
      label: 'Principal',
      align: 'right',
      width: '12%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.principal),
      footer: fmtINR(sums.principal),
    },
    {
      field: 'rate',
      label: 'Rate',
      align: 'right',
      width: '7%',
      defaultDir: 'desc',
      renderCell: (r) => (r.interest_rate !== null ? `${Number(r.interest_rate)}%` : '—'),
    },
    {
      field: 'tenure',
      label: 'Tenure',
      align: 'right',
      width: '8%',
      defaultDir: 'desc',
      renderCell: (r) => (r.tenure !== null ? `${r.tenure} mo` : '—'),
    },
    {
      field: 'payable',
      label: 'Payable',
      align: 'right',
      width: '13%',
      defaultDir: 'desc',
      cellSx: { fontWeight: 600 },
      renderCell: (r) => inr(r.total_payable),
      footer: fmtINR(sums.payable),
    },
    {
      field: 'status',
      label: 'Status',
      width: '10%',
      renderCell: (r) => STATUS_LABELS[r.status] ?? r.status,
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      'hp_register.csv',
      ['HP No', 'Customer', 'Mobile', 'Vehicle', 'Approved', 'Principal', 'Rate %', 'Tenure (mo)', 'Total payable', 'Status'],
      rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.customer_mobile,
        r.vehicle_plate,
        r.approval_date,
        r.principal,
        r.interest_rate,
        r.tenure,
        r.total_payable,
        STATUS_LABELS[r.status] ?? r.status,
      ]),
    )

  const exportPdf = () =>
    downloadTablePdf({
      filename: 'HP_Register.pdf',
      title: 'HP Register',
      subtitle: [
        `${rows.length} of ${report?.total_loans ?? rows.length} finances`,
        search.trim() && `Search: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      orientation: 'landscape',
      columns: [
        { header: 'HP No', width: 0.1 },
        { header: 'Customer', width: 0.2 },
        { header: 'Mobile', width: 0.09 },
        { header: 'Vehicle', width: 0.09 },
        { header: 'Approved', width: 0.09 },
        { header: 'Principal', width: 0.1, align: 'right' },
        { header: 'Rate %', width: 0.06, align: 'right' },
        { header: 'Tenure', width: 0.06, align: 'right' },
        { header: 'Total payable', width: 0.11, align: 'right' },
        { header: 'Status', width: 0.1 },
      ],
      rows: rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        r.customer_mobile,
        r.vehicle_plate ?? '—',
        r.approval_date ? fmtDate(r.approval_date) : '—',
        pdfINR(r.principal),
        r.interest_rate ?? '—',
        r.tenure != null ? `${r.tenure} mo` : '—',
        pdfINR(r.total_payable),
        STATUS_LABELS[r.status] ?? r.status,
      ]),
      totals: ['TOTAL', '', '', '', '', pdfINR(sums.principal), '', '', pdfINR(sums.payable), ''],
      note: 'Totals cover the rows in this document (the filters above), not the whole register.',
    })

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="hpreg"
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
              <KpiCard label="Finances" value={String(report.total_loans)} />
              <KpiCard label="Customers" value={String(report.total_customers)} />
              <KpiCard label="Principal financed" value={inr(report.total_principal)} />
              <KpiCard label="Total payable" value={inr(report.total_payable)} />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="hpreg-search"
                  placeholder="Filter by customer, mobile, HP number, or plate…"
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
                minWidth={1000}
                estimateRowHeight={52}
              />
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
