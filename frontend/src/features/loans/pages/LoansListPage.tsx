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
import CloseIcon from '@mui/icons-material/Close'

import {
  useInfiniteLoans,
  type LoanResponse,
  type LoanSortField,
  type SortOrder,
} from '@/api/queries/loans'
import { useCustomer } from '@/api/queries/customers'
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
import { TopScrollbar } from '@/components/infinite/TopScrollbar'
import { isoOrUndefined, rangeError, type DateRangeValue } from '@/lib/dateRange'
import dayjs from 'dayjs'
import type { LoanStatus } from '@/schemas/enums'
import { LOAN_STATUS_META, LOAN_STATUS_ORDER } from '../loanStatusMeta'
import { LoanStatusChip } from '../components/LoanStatusChip'
import { ApprovalQueue } from '../components/ApprovalQueue'
import { EmiDueChip } from '../components/EmiDueChip'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { loanDisplayId } from '../loanIdentity'
import { fmtDate } from '@/lib/format'

const routeApi = getRouteApi('/_authed/finances/')

// Rows fetched per network page. Larger than the old 20-per-page pager so a
// scroll pulls a meaningful chunk without a request per handful of rows.
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

// Server-side sort (mirrors the customers list). The backend default is
// created_at desc, which the SNO column reflects when no sort is in the URL.
const DEFAULT_SORT_FIELD: LoanSortField = 'created_at'
const DEFAULT_SORT_ORDER: SortOrder = 'desc'

// Headers in column order. `sortable` headers map to a backend LoanSortField;
// the rest (HP No, Mobile, REG No) are display-only.
interface ColumnHeader {
  label: string
  sortable: boolean
  field?: LoanSortField
  defaultDir?: SortOrder
}

const COLUMN_HEADERS: ReadonlyArray<ColumnHeader> = [
  { label: 'SNO', sortable: true, field: 'created_at', defaultDir: 'desc' },
  { label: 'HP No', sortable: false },
  { label: 'Customer Name', sortable: true, field: 'full_name', defaultDir: 'asc' },
  { label: 'Mobile', sortable: false },
  { label: 'Mandal/Village', sortable: true, field: 'mandal_village', defaultDir: 'asc' },
  { label: 'REG No', sortable: false },
  { label: 'Approved', sortable: true, field: 'approval_date', defaultDir: 'desc' },
  { label: 'Status', sortable: true, field: 'status', defaultDir: 'asc' },
]

// Mobile sort dropdown options — one per state the headers can produce.
const SORT_OPTIONS: readonly SortOption<LoanSortField>[] = [
  { value: 'created_at:desc', label: 'Newest first', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest first', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'full_name:asc', label: 'Name (A → Z)', sort_by: 'full_name', sort_order: 'asc' },
  { value: 'full_name:desc', label: 'Name (Z → A)', sort_by: 'full_name', sort_order: 'desc' },
  { value: 'mandal_village:asc', label: 'Mandal/Village (A → Z)', sort_by: 'mandal_village', sort_order: 'asc' },
  { value: 'mandal_village:desc', label: 'Mandal/Village (Z → A)', sort_by: 'mandal_village', sort_order: 'desc' },
  { value: 'status:asc', label: 'Status (A → Z)', sort_by: 'status', sort_order: 'asc' },
  { value: 'status:desc', label: 'Status (Z → A)', sort_by: 'status', sort_order: 'desc' },
  { value: 'approval_date:desc', label: 'Approved (newest)', sort_by: 'approval_date', sort_order: 'desc' },
  { value: 'approval_date:asc', label: 'Approved (oldest)', sort_by: 'approval_date', sort_order: 'asc' },
]

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading finances.'
}

const Dash = () => (
  <Typography component="span" variant="body2" color="text.secondary">
    —
  </Typography>
)

export function LoansListPage() {
  const {
    status,
    pending_approval,
    customer_id,
    assigned_to,
    search: searchTerm,
    date_from,
    date_to,
    sort_by,
    sort_order,
  } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  // Creation-date window (scopes the list). A backwards range doesn't query.
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

  const setSort = (next: { sort_by: LoanSortField; sort_order: SortOrder }) =>
    navigate({
      search: (prev) => ({ ...prev, sort_by: next.sort_by, sort_order: next.sort_order }),
      replace: true,
    })

  // Search: local draft debounced into the URL. Mirrors the customers list —
  // `lastWrittenSearch` lets the URL→draft sync ignore echoes of our own
  // debounced writes so typing isn't clobbered mid-stream.
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
      navigate({
        search: (prev) => ({ ...prev, search: next }),
        replace: true,
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft, navigate])

  useEffect(() => {
    if (searchTerm !== lastWrittenSearch.current) {
      lastWrittenSearch.current = searchTerm
      setDraft(searchTerm ?? '')
    }
  }, [searchTerm])

  const query = useInfiniteLoans({
    page_size: PAGE_SIZE,
    status,
    pending_approval,
    customer_id,
    assigned_employee_id: assigned_to,
    search: searchTerm,
    created_after: invalidRange ? undefined : isoOrUndefined(range.from),
    created_before: invalidRange ? undefined : isoOrUndefined(range.to),
    include: 'customer,vehicle',
    sort_by,
    sort_order,
  })

  // Only to label the customer filter chip; cheap and cached.
  const customerQuery = useCustomer(customer_id)

  const rows = query.data?.pages.flatMap((p) => p.results) ?? []
  const total = query.data?.pages[0]?.total ?? 0

  // Identifies the active query; when it changes the scroll views jump to top.
  const resetKey = JSON.stringify([
    status,
    pending_approval,
    customer_id,
    assigned_to,
    searchTerm,
    date_from,
    date_to,
    sort_by,
    sort_order,
  ])

  const goToCreate = () => navigate({ to: '/finances/new', search: { step: 0 } })

  // Status and the "Awaiting approval" filter are mutually exclusive — picking
  // one clears the other so the chip row always reflects a single active view.
  const setStatus = (next: LoanStatus | undefined) =>
    navigate({ search: (prev) => ({ ...prev, status: next, pending_approval: undefined }) })

  const setPendingApproval = (next: boolean) =>
    navigate({
      search: (prev) => ({
        ...prev,
        status: undefined,
        pending_approval: next ? true : undefined,
      }),
    })

  const clearCustomer = () =>
    navigate({ search: (prev) => ({ ...prev, customer_id: undefined }) })

  const setAssignedTo = (next: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, assigned_to: next }) })

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      {/* Responsive toolbar. On mobile the controls reorder to:
          search → New finance → filter chips → sort. On sm+ it's a single row
          (title · search · sort · new finance) with the chips below. */}
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 2,
        }}
      >
        <Typography variant="h2" sx={{ order: 0, width: { xs: '100%', sm: 'auto' } }}>
          Finances
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
            id="finance-search"
            placeholder="Search by loan number, name, mobile, or mandal…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </Box>

        <Box sx={{ order: { xs: 2, sm: 4 }, width: { xs: '100%', sm: 'auto' } }}>
          <Btn
            variant="primary"
            startIcon={<AddIcon />}
            onClick={goToCreate}
            sx={{ whiteSpace: 'nowrap', width: { xs: '100%', sm: 'auto' } }}
          >
            New finance
          </Btn>
        </Box>

        <Box sx={{ order: { xs: 4, sm: 2 }, width: { xs: '100%', sm: 'auto' } }}>
          <SortSelect options={SORT_OPTIONS} sort_by={sort_by} sort_order={sort_order} onChange={setSort} />
        </Box>

        {isAdmin && (
          <Box sx={{ order: { xs: 5, sm: 3 }, width: { xs: '100%', sm: 'auto' } }}>
            <AssignedToSelect value={assigned_to} onChange={setAssignedTo} />
          </Box>
        )}

        <Box sx={{ order: { xs: 3, sm: 5 }, width: '100%' }}>
          {customer_id && (
            <Box sx={{ mb: 2 }}>
              <Chip
                label={`Customer: ${customerQuery.data?.full_name ?? '…'}`}
                onDelete={clearCustomer}
                deleteIcon={<CloseIcon />}
                color="primary"
                variant="outlined"
                sx={{ height: 36, fontWeight: 500 }}
              />
            </Box>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, rowGap: 1 }}>
            <Chip
              label="All"
              onClick={() => setStatus(undefined)}
              color={status || pending_approval ? 'default' : 'primary'}
              variant={status || pending_approval ? 'outlined' : 'filled'}
              sx={{ height: 36 }}
            />
            <Chip
              label="Awaiting approval"
              onClick={() => setPendingApproval(!pending_approval)}
              color={pending_approval ? 'primary' : 'default'}
              variant={pending_approval ? 'filled' : 'outlined'}
              sx={{ height: 36 }}
            />
            {LOAN_STATUS_ORDER.map((s) => {
              const selected = status === s
              return (
                <Chip
                  key={s}
                  label={LOAN_STATUS_META[s].label}
                  onClick={() => setStatus(selected ? undefined : s)}
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
          idPrefix="finances"
          value={range}
          onChange={setRange}
          fromLabel="Created from"
          toLabel="Created to"
        />
        {invalidRange && (
          <Box sx={{ mt: 1 }}>
            <ErrorBanner message={invalidRange} />
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
          filtered={
            !!status ||
            !!pending_approval ||
            !!customer_id ||
            !!assigned_to ||
            !!searchTerm ||
            !!date_from ||
            !!date_to
          }
          onCreate={goToCreate}
        />
      ) : (
        <>
          <CountBar loaded={rows.length} total={total} noun="finance" nounPlural="finances" />
          {pending_approval ? (
            // Awaiting approval: glanceable cards with the Approve action on each,
            // in place of the table (every row here is a DRAFT, so the status
            // column carried no signal).
            <ApprovalQueue
              rows={rows}
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={query.fetchNextPage}
            />
          ) : (
            <>
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
        </>
      )}
    </Box>
  )
}

// Shared props for the two infinite-scroll views.
interface InfiniteProps {
  rows: LoanResponse[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  // Changes whenever the filter/sort set changes — the views scroll back to the
  // top so a new query doesn't leave you stranded mid-way down the old results.
  resetKey: string
}

// --------------------------------------------------
// Desktop table — md and up (virtualized + infinite)
// --------------------------------------------------

interface DesktopTableProps extends InfiniteProps {
  sort_by: LoanSortField | undefined
  sort_order: SortOrder | undefined
  onSortChange: (next: { sort_by: LoanSortField; sort_order: SortOrder }) => void
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

  const { scrollRef, virtualizer, virtualRows, paddingTop, paddingBottom } = useInfiniteRows({
    count: rows.length,
    estimateSize: 53,
    overscan: 12,
    getItemKey: (i) => rows[i]!.id,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  // Clicking the active column flips direction; clicking an inactive column
  // applies that column's default direction.
  const handleHeaderClick = (field: LoanSortField, defaultDir: SortOrder) => {
    const isActive =
      sort_by === field || (sort_by === undefined && field === DEFAULT_SORT_FIELD)
    const effectiveOrder = sort_by === undefined ? DEFAULT_SORT_ORDER : sort_order ?? DEFAULT_SORT_ORDER
    const next: SortOrder = isActive ? (effectiveOrder === 'asc' ? 'desc' : 'asc') : defaultDir
    onSortChange({ sort_by: field, sort_order: next })
  }

  // Reflects URL state; with no URL sort, created_at desc is the implicit
  // active sort (matches the backend default).
  const activeField: LoanSortField = sort_by ?? DEFAULT_SORT_FIELD
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
          <Table
            stickyHeader
            size="small"
            sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}
          >
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
                const l = rows[vr.index]!
                return (
                  <TableRow
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    hover
                    onClick={() =>
                      navigate({ to: '/finances/$loanId', params: { loanId: l.id } })
                    }
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>{vr.index + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                      {loanDisplayId(l)}
                    </TableCell>
                    <TableCell>{l.customer?.full_name ?? <Dash />}</TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                      {l.customer?.mobile_number ?? <Dash />}
                    </TableCell>
                    <TableCell>{l.customer?.mandal_village ?? <Dash />}</TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                      {l.vehicle?.plate_number ?? <Dash />}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                      {l.approval_date ? fmtDate(l.approval_date) : <Dash />}
                    </TableCell>
                    <TableCell>
                      {/* Fixed min-width keeps every status/EMI chip the same
                          width, down the whole column and within each cell. */}
                      <Stack
                        spacing={0.5}
                        sx={{ '& .MuiChip-root': { minWidth: 168, justifyContent: 'center' } }}
                      >
                        <LoanStatusChip status={l.status} />
                        <EmiDueChip status={l.emi_due_status} />
                      </Stack>
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

function MobileCards({
  rows,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
}: InfiniteProps) {
  const navigate = routeApi.useNavigate()

  const { scrollRef, virtualizer, virtualRows, totalSize } = useInfiniteRows({
    count: rows.length,
    estimateSize: 196,
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
            const l = rows[vr.index]!
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
                  onClick={() => navigate({ to: '/finances/$loanId', params: { loanId: l.id } })}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
                    '&:hover': { borderColor: 'primary.main' },
                    '&:active': { boxShadow: 'var(--shadow-hover)' },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
                  >
                    <Typography
                      variant="h3"
                      sx={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-mono)' }}
                    >
                      {loanDisplayId(l)}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <LoanStatusChip status={l.status} />
                      <Typography variant="caption" color="text.secondary">
                        #{vr.index + 1}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75 }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Name:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {l.customer?.full_name ?? '—'}
                    </Box>
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Phone No:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {l.customer?.mobile_number ?? '—'}
                    </Box>
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Mandal/Village:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {l.customer?.mandal_village ?? '—'}
                    </Box>
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.75, fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  >
                    REG {l.vehicle?.plate_number ?? '—'}
                  </Typography>
                  {l.emi_due_status && l.emi_due_status !== 'NONE' && (
                    <Box sx={{ mt: 1 }}>
                      <EmiDueChip status={l.emi_due_status} />
                    </Box>
                  )}
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
  filtered: boolean
  onCreate: () => void
}

function EmptyState({ filtered, onCreate }: EmptyStateProps) {
  if (filtered) {
    return (
      <Card>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3">No matching finances</Typography>
          <Typography variant="body2" color="text.secondary">
            No finances match the current filters. Clear them to see all finances.
          </Typography>
        </Stack>
      </Card>
    )
  }
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">No finances yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Start a new finance to capture the customer, vehicle, documents, and loan terms.
        </Typography>
        <Btn variant="primary" startIcon={<AddIcon />} onClick={onCreate} sx={{ mt: 1 }}>
          New finance
        </Btn>
      </Stack>
    </Card>
  )
}
