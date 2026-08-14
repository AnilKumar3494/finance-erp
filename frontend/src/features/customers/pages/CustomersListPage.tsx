import { useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import dayjs from 'dayjs'
import { getRouteApi } from '@tanstack/react-router'
import Box from '@mui/material/Box'
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
  useInfiniteCustomers,
  type CustomerResponse,
  type CustomerSortField,
  type SortOrder,
} from '@/api/queries/customers'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { AssignedToSelect } from '@/components/filters/AssignedToSelect'
import { DateRangeFilter } from '@/components/filters/DateRangeFilter'
import {
  LIST_MAX_HEIGHT,
  LIST_MIN_HEIGHT,
  stickyHeaderCellSx,
  useInfiniteRows,
} from '@/components/infinite/listScroll'
import { CountBar, LoadMoreFooter } from '@/components/infinite/InfiniteFooter'
import { isoOrUndefined, rangeError, type DateRangeValue } from '@/lib/dateRange'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { fmtDate } from '@/lib/format'

const routeApi = getRouteApi('/_authed/customers/')

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading customers.'
}

export function CustomersListPage() {
  const {
    search: searchTerm,
    assigned_to,
    date_from,
    date_to,
    sort_by,
    sort_order,
  } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const setAssignedTo = (next: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, assigned_to: next }), replace: true })

  // Created-date window, dayjs for the pickers and ISO for the API.
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
  const dateError = rangeError(range)

  const setSort = (next: { sort_by: CustomerSortField; sort_order: SortOrder }) =>
    navigate({
      search: (prev) => ({ ...prev, sort_by: next.sort_by, sort_order: next.sort_order }),
      replace: true,
    })

  const [draft, setDraft] = useState(() => searchTerm ?? '')
  const isFirstRun = useRef(true)
  // Track the last value we wrote to the URL so the URL→draft sync below
  // can distinguish "echo of our own debounced write" from a genuinely
  // external nav (browser back/forward, deep link). Echoes are ignored.
  const lastWrittenSearch = useRef<string | undefined>(searchTerm)

  // Local draft → URL (debounced).
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    const t = setTimeout(() => {
      const next = draft.trim() || undefined
      lastWrittenSearch.current = next
      navigate({
        search: (prev) => ({ ...prev, search: next }),
        replace: true,
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft, navigate])

  // URL → draft, but ONLY when the URL value differs from what we last
  // wrote. Otherwise we'd overwrite mid-typing on every debounced commit.
  useEffect(() => {
    if (searchTerm !== lastWrittenSearch.current) {
      lastWrittenSearch.current = searchTerm
      setDraft(searchTerm ?? '')
    }
  }, [searchTerm])

  const query = useInfiniteCustomers(
    {
      page_size: PAGE_SIZE,
      search: searchTerm,
      assigned_employee_id: assigned_to,
      created_after: date_from,
      created_before: date_to,
      sort_by,
      sort_order,
    },
    // A backwards range would just return nothing, which reads as "no data"
    // rather than "bad input" — so don't ask.
    !dateError,
  )

  const rows = query.data?.pages.flatMap((p) => p.results) ?? []
  const total = query.data?.pages[0]?.total ?? 0

  // Identifies the active query; when it changes the scroll views jump to top.
  const resetKey = JSON.stringify([
    searchTerm,
    assigned_to,
    date_from,
    date_to,
    sort_by,
    sort_order,
  ])

  const goToCreate = () => navigate({ to: '/customers/new' })

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ mb: 3, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        {/* Search gets its own full-width block on small screens; on sm+ it
            flexes alongside the sort + create controls. */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Input
            id="customer-search"
            placeholder="Search by name, mobile, or assigned employee…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'flex-end' }}
        >
          {/* Employees are scoped to their own customers server-side, so the
              filter would be a no-op for them — admins only, as on Finances. */}
          {isAdmin && <AssignedToSelect value={assigned_to} onChange={setAssignedTo} />}
          <SortSelect
            options={SORT_OPTIONS}
            sort_by={sort_by}
            sort_order={sort_order}
            onChange={setSort}
          />
          <Btn
            variant="primary"
            startIcon={<AddIcon />}
            onClick={goToCreate}
            sx={{ whiteSpace: 'nowrap', width: { xs: '100%', sm: 'auto' } }}
          >
            New customer
          </Btn>
        </Stack>
      </Stack>

      <Box sx={{ mb: 3 }}>
        <DateRangeFilter
          idPrefix="customers"
          value={range}
          onChange={setRange}
          fromLabel="Created from"
          toLabel="Created to"
        />
        {dateError && (
          <Box sx={{ mt: 1 }}>
            <ErrorBanner message={dateError} />
          </Box>
        )}
      </Box>

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
        <EmptyState
          searchTerm={searchTerm}
          filtered={!!assigned_to || !!date_from || !!date_to}
          onCreate={goToCreate}
        />
      ) : (
        <>
          <CountBar loaded={rows.length} total={total} noun="customer" nounPlural="customers" />
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

// Shared props for the two infinite-scroll views.
interface InfiniteProps {
  rows: CustomerResponse[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  resetKey: string
}

// --------------------------------------------------
// Desktop table — md and up (virtualized + infinite)
// --------------------------------------------------

interface DesktopTableProps extends InfiniteProps {
  sort_by: CustomerSortField | undefined
  sort_order: SortOrder | undefined
  onSortChange: (next: { sort_by: CustomerSortField; sort_order: SortOrder }) => void
}

// Headers in column order. `sortable` controls whether the header is
// wrapped in TableSortLabel — mobile_number is shown but intentionally
// not sortable because there's no useful product story for ordering by
// phone number.
interface ColumnHeader {
  label: string
  sortable: boolean
  field?: CustomerSortField
  defaultDir?: SortOrder
}

const COLUMN_HEADERS: ReadonlyArray<ColumnHeader> = [
  // Positional serial number (like the Finances/Vehicles lists). Sorting is
  // driven by the "Created" column, so SNO stays a plain display cell.
  { label: 'SNO', sortable: false },
  { label: 'Name', sortable: true, field: 'full_name', defaultDir: 'asc' },
  { label: 'Mobile', sortable: false },
  {
    label: 'Assigned to',
    sortable: true,
    field: 'assigned_employee_name',
    defaultDir: 'asc',
  },
  { label: 'Created', sortable: true, field: 'created_at', defaultDir: 'desc' },
]

// Mobile sort dropdown options — one per state the headers can produce.
const SORT_OPTIONS: readonly SortOption<CustomerSortField>[] = [
  { value: 'created_at:desc', label: 'Newest first', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest first', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'full_name:asc', label: 'Name (A → Z)', sort_by: 'full_name', sort_order: 'asc' },
  { value: 'full_name:desc', label: 'Name (Z → A)', sort_by: 'full_name', sort_order: 'desc' },
  { value: 'assigned_employee_name:asc', label: 'Assigned (A → Z)', sort_by: 'assigned_employee_name', sort_order: 'asc' },
  { value: 'assigned_employee_name:desc', label: 'Assigned (Z → A)', sort_by: 'assigned_employee_name', sort_order: 'desc' },
]

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
  const goToDetail = (id: string) =>
    navigate({ to: '/customers/$customerId', params: { customerId: id } })

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

  // Clicking the active column flips the direction. Clicking an inactive
  // column applies that field's default direction (asc for names, desc
  // for created).
  const handleHeaderClick = (field: CustomerSortField, defaultDir: SortOrder) => {
    const isActive =
      sort_by === field || (sort_by === undefined && field === 'created_at')
    const effectiveOrder = sort_by === undefined ? 'desc' : sort_order ?? 'desc'
    const next: SortOrder = isActive
      ? effectiveOrder === 'asc'
        ? 'desc'
        : 'asc'
      : defaultDir
    onSortChange({ sort_by: field, sort_order: next })
  }

  // Reflects URL state. When no URL sort is set, "created_at desc" is the
  // implicit active sort (matches the backend default).
  const activeField: CustomerSortField = sort_by ?? 'created_at'
  const activeOrder: SortOrder = sort_by === undefined ? 'desc' : sort_order ?? 'desc'

  const spacer = (height: number) =>
    height > 0 ? (
      <TableRow style={{ height }}>
        <TableCell colSpan={COLUMN_HEADERS.length} sx={{ p: 0, border: 0 }} />
      </TableRow>
    ) : null

  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer
          ref={scrollRef}
          sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
        >
          <Table stickyHeader size="small">
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
                      sx={stickyHeaderCellSx}
                    />
                  ) : (
                    <TableCell key={h.label} sx={stickyHeaderCellSx}>
                      {h.label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {spacer(paddingTop)}
              {virtualRows.map((vr) => {
                const c = rows[vr.index]!
                return (
                  <TableRow
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    hover
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${c.full_name}`}
                    onClick={() => goToDetail(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goToDetail(c.id)
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
                    <TableCell>{c.full_name}</TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                      {c.mobile_number}
                    </TableCell>
                    <TableCell>
                      {c.assigned_employee_name ?? (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          Unassigned
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{fmtDate(c.created_at)}</TableCell>
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
  const goToDetail = (id: string) =>
    navigate({ to: '/customers/$customerId', params: { customerId: id } })

  const { scrollRef, virtualizer, virtualRows, totalSize } = useInfiniteRows({
    count: rows.length,
    estimateSize: 132,
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
            const c = rows[vr.index]!
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
                  aria-label={`Open ${c.full_name}`}
                  onClick={() => goToDetail(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      goToDetail(c.id)
                    }
                  }}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
                    '&:hover': {
                      borderColor: 'primary.main',
                    },
                    '&:active': {
                      boxShadow: 'var(--shadow-hover)',
                    },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: -2,
                    },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
                  >
                    <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 600 }}>
                      {c.full_name}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        {fmtDate(c.created_at)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        #{vr.index + 1}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.5, fontFamily: 'var(--font-mono)' }}
                  >
                    {c.mobile_number}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {c.assigned_employee_name
                      ? `Assigned: ${c.assigned_employee_name}`
                      : 'Unassigned'}
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

interface EmptyStateProps {
  searchTerm: string | undefined
  // Any non-search filter (assignee, created window) is narrowing the list —
  // without this, an over-tight filter renders "No customers yet", which is
  // plainly wrong when the book has thousands.
  filtered: boolean
  onCreate: () => void
}

function EmptyState({ searchTerm, filtered, onCreate }: EmptyStateProps) {
  if (!searchTerm && filtered) {
    return (
      <Card>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3">No matches</Typography>
          <Typography variant="body2" color="text.secondary">
            No customers match the selected filters. Try widening the date range
            or clearing the assignee.
          </Typography>
        </Stack>
      </Card>
    )
  }
  if (searchTerm) {
    return (
      <Card>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3">No matches</Typography>
          <Typography variant="body2" color="text.secondary">
            No customers match “{searchTerm}”. Try a different name, mobile, or
            employee.
          </Typography>
        </Stack>
      </Card>
    )
  }
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">No customers yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Add your first customer to start tracking loans, documents, and KYC.
        </Typography>
        <Btn
          variant="primary"
          startIcon={<AddIcon />}
          onClick={onCreate}
          sx={{ mt: 1 }}
        >
          New customer
        </Btn>
      </Stack>
    </Card>
  )
}
