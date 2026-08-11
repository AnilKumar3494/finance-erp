import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import MenuItem from '@mui/material/MenuItem'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useVehicleRegister, type VehicleRegisterRow } from '@/api/queries/reports'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import type { AssetStatus, AssetType } from '@/schemas/enums'
import { ASSET_TYPE_LABELS, VEHICLE_STATUS_META } from '@/features/vehicles/vehicleStatusMeta'
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

const statusLabel = (s: string) => VEHICLE_STATUS_META[s as AssetStatus]?.label ?? s
const typeLabel = (t: string) => ASSET_TYPE_LABELS[t as AssetType] ?? t

const makeModel = (r: VehicleRegisterRow) => [r.make, r.model].filter(Boolean).join(' ') || '—'

type Field =
  | 'plate'
  | 'vehicle'
  | 'year'
  | 'type'
  | 'status'
  | 'finance'
  | 'market'
  | 'purchase'

const ACCESSORS: Partial<Record<Field, (r: VehicleRegisterRow) => string | number | null>> = {
  plate: (r) => r.plate_number,
  vehicle: (r) => makeModel(r),
  year: (r) => r.year,
  type: (r) => r.type,
  status: (r) => r.status,
  finance: (r) => r.hp_number,
  market: (r) => Number(r.market_value),
  purchase: (r) => Number(r.purchase_cost),
}

/**
 * Vehicle Register — the collateral & inventory valuation register: every
 * vehicle with its market value, purchase cost, and the finance it is pledged
 * against (if any). The date window bounds the registration date.
 */
export function VehiclesReportTab() {
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE)
  const invalidRange = rangeError(range)
  const query = useVehicleRegister(!invalidRange, {
    date1: isoOrUndefined(range.from),
    date2: isoOrUndefined(range.to),
  })
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({
    sort_by: 'market',
    sort_order: 'desc',
  })
  const onSort = (field: Field, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))

  const filtered = useMemo(() => {
    let rows = report?.results ?? []
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.plate_number.toLowerCase().includes(q) ||
        makeModel(r).toLowerCase().includes(q) ||
        (r.customer_name ?? '').toLowerCase().includes(q) ||
        (r.hp_number ?? '').toLowerCase().includes(q),
    )
  }, [report, search, statusFilter])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  // Footer totals track the visible (filtered) rows; the KPI cards above stay
  // register-wide.
  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          market: a.market + Number(r.market_value),
          purchase: a.purchase + Number(r.purchase_cost),
        }),
        { market: 0, purchase: 0 },
      ),
    [rows],
  )

  // Statuses present in the data, for the filter dropdown.
  const statusOptions = useMemo(
    () => [...new Set((report?.results ?? []).map((r) => r.status))],
    [report],
  )

  const columns: VirtualColumn<VehicleRegisterRow, Field>[] = [
    {
      field: 'plate',
      label: 'Plate',
      width: '11%',
      cellSx: { fontFamily: 'var(--font-mono)' },
      renderCell: (r) => r.plate_number,
    },
    {
      field: 'vehicle',
      label: 'Make / Model',
      width: '17%',
      renderCell: (r) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {makeModel(r)}
          </Typography>
          {r.year != null && (
            <Typography variant="caption" color="text.secondary">
              {r.year}
            </Typography>
          )}
        </>
      ),
    },
    {
      field: 'type',
      label: 'Type',
      width: '10%',
      renderCell: (r) => typeLabel(r.type),
    },
    {
      field: 'status',
      label: 'Status',
      width: '11%',
      renderCell: (r) => statusLabel(r.status),
    },
    {
      field: 'finance',
      label: 'Pledged to',
      width: '19%',
      renderCell: (r) =>
        r.hp_number ? (
          <>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}
            >
              {r.hp_number}
            </Typography>
            {r.customer_name && (
              <Typography variant="caption" color="text.secondary">
                {r.customer_name}
              </Typography>
            )}
          </>
        ) : (
          '—'
        ),
    },
    {
      field: 'market',
      label: 'Market value',
      align: 'right',
      width: '16%',
      defaultDir: 'desc',
      cellSx: { fontWeight: 600 },
      renderCell: (r) => inr(r.market_value),
      footer: fmtINR(sums.market),
    },
    {
      field: 'purchase',
      label: 'Purchase cost',
      align: 'right',
      width: '16%',
      defaultDir: 'desc',
      renderCell: (r) => inr(r.purchase_cost),
      footer: fmtINR(sums.purchase),
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      'vehicle_register.csv',
      ['Plate', 'Make', 'Model', 'Year', 'Type', 'Status', 'Pledged HP No', 'Customer', 'Market value', 'Purchase cost'],
      rows.map((r) => [
        r.plate_number,
        r.make ?? '',
        r.model ?? '',
        r.year ?? '',
        typeLabel(r.type),
        statusLabel(r.status),
        r.hp_number ?? '',
        r.customer_name ?? '',
        r.market_value,
        r.purchase_cost,
      ]),
    )

  const exportPdf = () =>
    downloadTablePdf({
      filename: 'Vehicle_Register.pdf',
      title: 'Vehicle Register',
      subtitle: [
        `${rows.length} of ${report?.total_vehicles ?? rows.length} vehicles`,
        statusFilter && `Status: ${statusLabel(statusFilter)}`,
        search.trim() && `Search: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      orientation: 'landscape',
      columns: [
        { header: 'Plate', width: 0.11 },
        { header: 'Make / Model', width: 0.18 },
        { header: 'Year', width: 0.07 },
        { header: 'Type', width: 0.1 },
        { header: 'Status', width: 0.12 },
        { header: 'Pledged to', width: 0.18 },
        { header: 'Market value', width: 0.12, align: 'right' },
        { header: 'Purchase cost', width: 0.12, align: 'right' },
      ],
      rows: rows.map((r) => [
        r.plate_number,
        makeModel(r),
        r.year != null ? String(r.year) : '—',
        typeLabel(r.type),
        statusLabel(r.status),
        r.hp_number ? `${r.hp_number}${r.customer_name ? ` · ${r.customer_name}` : ''}` : '—',
        pdfINR(r.market_value),
        pdfINR(r.purchase_cost),
      ]),
      totals: ['TOTAL', '', '', '', '', '', pdfINR(sums.market), pdfINR(sums.purchase)],
      note: 'Totals cover the rows in this document (the filters above), not the whole register.',
    })

  return (
    <Stack spacing={3}>
      <DateRangeFilter
        idPrefix="vehreg"
        value={range}
        onChange={setRange}
        fromLabel="Registered from"
        toLabel="Registered to"
      />

      {invalidRange && <ErrorBanner message={invalidRange} />}

      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard label="Vehicles" value={String(report.total_vehicles)} />
              <KpiCard label="In yard" value={String(report.status_counts?.IN_YARD ?? 0)} />
              <KpiCard
                label="With customer"
                value={String(report.status_counts?.WITH_CUSTOMER ?? 0)}
              />
              <KpiCard label="Market value" value={inr(report.total_market_value)} />
              <KpiCard label="Purchase cost" value={inr(report.total_purchase_cost)} />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="vehreg-search"
                  placeholder="Filter by plate, model, customer, or HP number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </Box>
              {statusOptions.length > 0 && (
                <Box sx={{ minWidth: 180 }}>
                  <Input
                    select
                    id="vehreg-status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    slotProps={{
                      select: {
                        displayEmpty: true,
                        renderValue: (v) => (v ? statusLabel(String(v)) : 'All statuses'),
                      },
                    }}
                  >
                    <MenuItem value="">All statuses</MenuItem>
                    {statusOptions.map((s) => (
                      <MenuItem key={s} value={s}>
                        {statusLabel(s)}
                      </MenuItem>
                    ))}
                  </Input>
                </Box>
              )}
              <Typography variant="body2" color="text.secondary">
                {rows.length} of {report.results.length} vehicles
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
                No vehicles match this filter.
              </Typography>
            ) : (
              <VirtualReportTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.vehicle_id}
                onRowClick={(r) =>
                  navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: r.vehicle_id } })
                }
                sort={sort}
                onSort={onSort}
                minWidth={980}
                estimateRowHeight={48}
              />
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
