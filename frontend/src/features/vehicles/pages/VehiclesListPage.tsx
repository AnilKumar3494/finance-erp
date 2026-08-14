import { useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { getRouteApi } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import AddIcon from '@mui/icons-material/Add'

import {
  useInfiniteVehicles,
  type VehicleListResponse,
  type VehicleResponse,
  type VehicleSortField,
  type SortOrder,
} from '@/api/queries/vehicles'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import {
  LIST_MAX_HEIGHT,
  LIST_MIN_HEIGHT,
  stickyHeaderCellSx,
  useInfiniteRows,
} from '@/components/infinite/listScroll'
import { CountBar, LoadMoreFooter } from '@/components/infinite/InfiniteFooter'
import { TopScrollbar } from '@/components/infinite/TopScrollbar'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import { isoOrUndefined, rangeError, type DateRangeValue } from '@/lib/dateRange'
import { KPI_GRID_SX, KpiCard } from '@/features/reports/components/KpiCard'
import { fmtINR } from '@/lib/format'
import dayjs from 'dayjs'
import type { AssetStatus, AssetType } from '@/schemas/enums'
import { AssetType as AssetTypeEnum } from '@/schemas/enums'
import {
  ASSET_STATUS_ORDER,
  ASSET_TYPE_LABELS,
  VEHICLE_STATUS_META,
} from '../vehicleStatusMeta'
import { VehicleStatusChip } from '../components/VehicleStatusChip'

const routeApi = getRouteApi('/_authed/vehicles/')

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

// Server-side sort (mirrors the customers/finances lists). The backend default
// is created_at desc, which the SNO column reflects when no sort is in the URL.
const DEFAULT_SORT_FIELD: VehicleSortField = 'created_at'
const DEFAULT_SORT_ORDER: SortOrder = 'desc'

interface ColumnHeader {
  label: string
  sortable: boolean
  field?: VehicleSortField
  defaultDir?: SortOrder
  align?: 'left' | 'right'
}

const COLUMN_HEADERS: ReadonlyArray<ColumnHeader> = [
  { label: 'SNO', sortable: true, field: 'created_at', defaultDir: 'desc' },
  { label: 'Plate', sortable: true, field: 'plate_number', defaultDir: 'asc' },
  { label: 'Make / Model', sortable: true, field: 'make', defaultDir: 'asc' },
  { label: 'Year', sortable: true, field: 'year', defaultDir: 'desc' },
  { label: 'Status', sortable: true, field: 'status', defaultDir: 'asc' },
  { label: 'Type', sortable: false },
  { label: 'Market value', sortable: true, field: 'market_value', defaultDir: 'desc', align: 'right' },
]

const SORT_OPTIONS: readonly SortOption<VehicleSortField>[] = [
  { value: 'created_at:desc', label: 'Newest first', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest first', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'plate_number:asc', label: 'Plate (A → Z)', sort_by: 'plate_number', sort_order: 'asc' },
  { value: 'plate_number:desc', label: 'Plate (Z → A)', sort_by: 'plate_number', sort_order: 'desc' },
  { value: 'make:asc', label: 'Make (A → Z)', sort_by: 'make', sort_order: 'asc' },
  { value: 'make:desc', label: 'Make (Z → A)', sort_by: 'make', sort_order: 'desc' },
  { value: 'year:desc', label: 'Year (newest)', sort_by: 'year', sort_order: 'desc' },
  { value: 'year:asc', label: 'Year (oldest)', sort_by: 'year', sort_order: 'asc' },
  { value: 'market_value:desc', label: 'Value (high → low)', sort_by: 'market_value', sort_order: 'desc' },
  { value: 'market_value:asc', label: 'Value (low → high)', sort_by: 'market_value', sort_order: 'asc' },
  { value: 'status:asc', label: 'Status (A → Z)', sort_by: 'status', sort_order: 'asc' },
]

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading vehicles.'
}

const money = (v: string | null | undefined) =>
  v != null && v !== '' ? fmtINR(Number(v)) : '—'

export function VehiclesListPage() {
  const { status, type, search: searchTerm, date_from, date_to, sort_by, sort_order } =
    routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  // Registration-date window (scopes the list + KPIs). Backwards ranges don't
  // query — the API would just return nothing, read as "no vehicles".
  const range: DateRangeValue = {
    from: date_from ? dayjs(date_from) : null,
    to: date_to ? dayjs(date_to) : null,
  }
  const setRange = (next: DateRangeValue) =>
    navigate({
      search: (prev) => ({
        ...prev,
        date_from: isoOrUndefined(next.from),
        date_to: isoOrUndefined(next.to),
      }),
      replace: true,
    })
  const invalidRange = rangeError(range)

  const setSort = (next: { sort_by: VehicleSortField; sort_order: SortOrder }) =>
    navigate({
      search: (prev) => ({ ...prev, sort_by: next.sort_by, sort_order: next.sort_order }),
      replace: true,
    })

  // Local search draft debounced into the URL (mirrors the customers list).
  const [draft, setDraft] = useState(() => searchTerm ?? '')
  const isFirstRun = useRef(true)
  const lastWrittenSearch = useRef<string | undefined>(searchTerm)

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    const t = setTimeout(() => {
      const next = draft.trim() || undefined
      lastWrittenSearch.current = next
      navigate({ search: (prev) => ({ ...prev, search: next }), replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft, navigate])

  useEffect(() => {
    if (searchTerm !== lastWrittenSearch.current) {
      lastWrittenSearch.current = searchTerm
      setDraft(searchTerm ?? '')
    }
  }, [searchTerm])

  const query = useInfiniteVehicles({
    page_size: PAGE_SIZE,
    search: searchTerm,
    status,
    type,
    created_after: invalidRange ? undefined : isoOrUndefined(range.from),
    created_before: invalidRange ? undefined : isoOrUndefined(range.to),
    sort_by,
    sort_order,
  })

  const rows = query.data?.pages.flatMap((p) => p.results) ?? []
  const firstPage = query.data?.pages[0]
  const total = firstPage?.total ?? 0

  const resetKey = JSON.stringify([
    status,
    type,
    searchTerm,
    date_from,
    date_to,
    sort_by,
    sort_order,
  ])

  const goToCreate = () => navigate({ to: '/vehicles/new' })

  const setStatus = (next: AssetStatus | undefined) =>
    navigate({ search: (prev) => ({ ...prev, status: next }) })
  const setType = (next: AssetType | undefined) =>
    navigate({ search: (prev) => ({ ...prev, type: next }) })

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <Box
        sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 2 }}
      >
        <Typography variant="h2" sx={{ order: 0, width: { xs: '100%', sm: 'auto' } }}>
          Vehicles
        </Typography>

        <Box
          sx={{
            order: { xs: 1, sm: 1 },
            width: { xs: '100%', sm: 'auto' },
            flexGrow: { sm: 1 },
            minWidth: { sm: 220 },
          }}
        >
          <Input
            id="vehicle-search"
            placeholder="Search by plate number…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </Box>

        <Box sx={{ order: { xs: 2, sm: 3 }, width: { xs: '100%', sm: 'auto' } }}>
          <Btn
            variant="primary"
            startIcon={<AddIcon />}
            onClick={goToCreate}
            sx={{ whiteSpace: 'nowrap', width: { xs: '100%', sm: 'auto' } }}
          >
            New vehicle
          </Btn>
        </Box>

        <Box sx={{ order: { xs: 4, sm: 2 }, width: { xs: '100%', sm: 'auto' } }}>
          <SortSelect options={SORT_OPTIONS} sort_by={sort_by} sort_order={sort_order} onChange={setSort} />
        </Box>

        <Box sx={{ order: { xs: 3, sm: 4 }, width: '100%' }}>
          {/* Status filter chips */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label="All statuses"
              onClick={() => setStatus(undefined)}
              color={status ? 'default' : 'primary'}
              variant={status ? 'outlined' : 'filled'}
              sx={{ height: 36 }}
            />
            {ASSET_STATUS_ORDER.map((s) => {
              const selected = status === s
              return (
                <Chip
                  key={s}
                  label={VEHICLE_STATUS_META[s].label}
                  onClick={() => setStatus(selected ? undefined : s)}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ height: 36 }}
                />
              )
            })}
          </Stack>
          {/* Type filter chips */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Chip
              label="All types"
              onClick={() => setType(undefined)}
              color={type ? 'default' : 'primary'}
              variant={type ? 'outlined' : 'filled'}
              sx={{ height: 36 }}
            />
            {AssetTypeEnum.options.map((t) => {
              const selected = type === t
              return (
                <Chip
                  key={t}
                  label={ASSET_TYPE_LABELS[t]}
                  onClick={() => setType(selected ? undefined : t)}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ height: 36 }}
                />
              )
            })}
          </Stack>
        </Box>
      </Box>

      <Box sx={{ mb: 2 }}>
        <DateRangeFilter
          idPrefix="vehicles"
          value={range}
          onChange={setRange}
          fromLabel="Registered from"
          toLabel="Registered to"
        />
        {invalidRange && (
          <Box sx={{ mt: 1 }}>
            <ErrorBanner message={invalidRange} />
          </Box>
        )}
      </Box>

      {firstPage && <VehiclesKpis data={firstPage} />}

      {query.isError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={mapListError(query.error)} />
        </Box>
      )}

      {query.isLoading && !query.data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : rows.length === 0 ? (
        <EmptyState filtered={!!status || !!type || !!searchTerm} onCreate={goToCreate} />
      ) : (
        <>
          <CountBar loaded={rows.length} total={total} noun="vehicle" nounPlural="vehicles" />
          <DesktopTable
            rows={rows}
            sort_by={sort_by}
            sort_order={sort_order}
            onSortChange={setSort}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={query.fetchNextPage}
            resetKey={resetKey}
          />
          <MobileCards
            rows={rows}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={query.fetchNextPage}
            resetKey={resetKey}
          />
        </>
      )}
    </Box>
  )
}

// Portfolio KPIs over the whole filtered set (server aggregates, not just the
// page), so they show every vehicle by default and narrow with the search,
// status/type chips, and registration-date window.
function VehiclesKpis({ data }: { data: VehicleListResponse }) {
  const c = data.status_counts
  return (
    <Box sx={{ ...KPI_GRID_SX, mb: 2 }}>
      <KpiCard label="Vehicles" value={String(data.total_vehicles)} />
      <KpiCard label="In yard" value={String(c?.IN_YARD ?? 0)} />
      <KpiCard label="With customer" value={String(c?.WITH_CUSTOMER ?? 0)} />
      <KpiCard label="Market value" value={money(data.total_market_value)} />
      <KpiCard label="Purchase cost" value={money(data.total_purchase_cost)} />
    </Box>
  )
}

function makeModel(v: VehicleResponse): string {
  return [v.make, v.model].filter(Boolean).join(' ') || '—'
}

// Shared props for the two infinite-scroll views.
interface InfiniteProps {
  rows: VehicleResponse[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  resetKey: string
}

// --------------------------------------------------
// Desktop table — md and up (virtualized + infinite)
// --------------------------------------------------

interface DesktopTableProps extends InfiniteProps {
  sort_by: VehicleSortField | undefined
  sort_order: SortOrder | undefined
  onSortChange: (next: { sort_by: VehicleSortField; sort_order: SortOrder }) => void
}

function DesktopTable({
  rows,
  sort_by,
  sort_order,
  onSortChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
}: DesktopTableProps) {
  const navigate = routeApi.useNavigate()
  const goToDetail = (id: string) => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: id } })

  const { scrollRef, virtualizer, virtualRows, paddingTop, paddingBottom } = useInfiniteRows({
    count: rows.length,
    estimateSize: 49,
    overscan: 12,
    getItemKey: (i) => rows[i]!.id,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  const handleHeaderClick = (field: VehicleSortField, defaultDir: SortOrder) => {
    const isActive = sort_by === field || (sort_by === undefined && field === DEFAULT_SORT_FIELD)
    const effectiveOrder = sort_by === undefined ? DEFAULT_SORT_ORDER : sort_order ?? DEFAULT_SORT_ORDER
    const next: SortOrder = isActive ? (effectiveOrder === 'asc' ? 'desc' : 'asc') : defaultDir
    onSortChange({ sort_by: field, sort_order: next })
  }

  const activeField: VehicleSortField = sort_by ?? DEFAULT_SORT_FIELD
  const activeOrder: SortOrder = sort_by === undefined ? DEFAULT_SORT_ORDER : sort_order ?? DEFAULT_SORT_ORDER

  const spacer = (height: number) =>
    height > 0 ? (
      <TableRow style={{ height }}>
        <TableCell colSpan={COLUMN_HEADERS.length} sx={{ p: 0, border: 0 }} />
      </TableRow>
    ) : null

  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TopScrollbar targetRef={scrollRef} />
        <TableContainer
          ref={scrollRef}
          sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
        >
          <Table stickyHeader size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                {COLUMN_HEADERS.map((h) =>
                  h.sortable && h.field && h.defaultDir ? (
                    <SortableTh
                      key={h.label}
                      field={h.field}
                      label={h.label}
                      activeField={activeField}
                      activeOrder={activeOrder}
                      defaultDir={h.defaultDir}
                      onSort={handleHeaderClick}
                      align={h.align}
                      sx={stickyHeaderCellSx}
                    />
                  ) : (
                    <TableCell key={h.label} align={h.align} sx={stickyHeaderCellSx}>
                      {h.label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {spacer(paddingTop)}
              {virtualRows.map((vr) => {
                const v = rows[vr.index]!
                return (
                  <TableRow
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    hover
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${v.plate_number}`}
                    onClick={() => goToDetail(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goToDetail(v.id)
                      }
                    }}
                    sx={{
                      cursor: 'pointer',
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: -2,
                      },
                    }}
                  >
                    <TableCell>{vr.index + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{v.plate_number}</TableCell>
                    <TableCell>{makeModel(v)}</TableCell>
                    <TableCell>{v.year ?? '—'}</TableCell>
                    <TableCell>
                      <VehicleStatusChip status={v.status} />
                    </TableCell>
                    <TableCell>{ASSET_TYPE_LABELS[v.type]}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'var(--font-mono)' }}>
                      {money(v.market_value)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {spacer(paddingBottom)}
            </TableBody>
          </Table>
        </TableContainer>
        <LoadMoreFooter
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          count={rows.length}
        />
      </Card>
    </Box>
  )
}

// --------------------------------------------------
// Mobile cards — below md (virtualized + infinite)
// --------------------------------------------------

function MobileCards({ rows, hasNextPage, isFetchingNextPage, fetchNextPage, resetKey }: InfiniteProps) {
  const navigate = routeApi.useNavigate()
  const goToDetail = (id: string) => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: id } })

  const { scrollRef, virtualizer, virtualRows, totalSize } = useInfiniteRows({
    count: rows.length,
    estimateSize: 150,
    overscan: 8,
    getItemKey: (i) => rows[i]!.id,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      <Box
        ref={scrollRef}
        sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
      >
        <Box sx={{ height: totalSize, position: 'relative' }}>
          {virtualRows.map((vr) => {
            const v = rows[vr.index]!
            return (
              <Box
                key={vr.key}
                data-index={vr.index}
                ref={virtualizer.measureElement}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vr.start}px)`,
                  pb: 1.5,
                }}
              >
                <Card
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${v.plate_number}`}
                  onClick={() => goToDetail(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      goToDetail(v.id)
                    }
                  }}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
                    '&:hover': { borderColor: 'primary.main' },
                    '&:active': { boxShadow: 'var(--shadow-hover)' },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: -2,
                    },
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h3" sx={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {v.plate_number}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <VehicleStatusChip status={v.status} />
                      <Typography variant="caption" color="text.secondary">
                        #{vr.index + 1}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75 }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Make / Model:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {makeModel(v)}
                      {v.year != null ? ` · ${v.year}` : ''}
                    </Box>
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Type:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {ASSET_TYPE_LABELS[v.type]}
                    </Box>
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {money(v.market_value)}
                  </Typography>
                </Card>
              </Box>
            )
          })}
        </Box>
      </Box>
      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        count={rows.length}
      />
    </Box>
  )
}

// --------------------------------------------------
// Empty state
// --------------------------------------------------

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  if (filtered) {
    return (
      <Card>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3">No matching vehicles</Typography>
          <Typography variant="body2" color="text.secondary">
            No vehicles match the current filters. Clear them to see all vehicles.
          </Typography>
        </Stack>
      </Card>
    )
  }
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">No vehicles yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Register your first vehicle to track inventory and loan collateral.
        </Typography>
        <Btn variant="primary" startIcon={<AddIcon />} onClick={onCreate} sx={{ mt: 1 }}>
          New vehicle
        </Btn>
      </Stack>
    </Card>
  )
}
