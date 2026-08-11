import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useHpReceivable, type HpReceivableRow } from '@/api/queries/reports'
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

  const columns: VirtualColumn<HpReceivableRow, Field>[] = [
    {
      field: 'hp',
      label: 'HP No',
      width: '18%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.hp_number ?? r.loan_number,
    },
    {
      field: 'customer',
      label: 'Customer',
      width: '42%',
      renderCell: (r) => (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {r.customer_name}
        </Typography>
      ),
    },
    {
      field: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      width: '20%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.outstanding),
      footer: fmtINR(sums.outstanding),
    },
    {
      field: 'receivable',
      label: 'Receivable interest',
      align: 'right',
      width: '20%',
      defaultDir: 'desc',
      cellSx: { fontWeight: 600, color: 'success.main' },
      renderCell: (r) => inr(r.receivable_interest),
      footer: fmtINR(sums.receivable),
      footerSx: { color: 'success.main' },
    },
  ]

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
              <VirtualReportTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.loan_id}
                onRowClick={(r) =>
                  navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })
                }
                sort={sort}
                onSort={onSort}
                minWidth={640}
                estimateRowHeight={40}
              />
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
