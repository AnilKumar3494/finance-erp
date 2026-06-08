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
import TableSortLabel from '@mui/material/TableSortLabel'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'

import {
  useLoans,
  type LoanResponse,
  type LoanSortField,
  type SortOrder,
} from '@/api/queries/loans'
import { useCustomer } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import type { LoanStatus } from '@/schemas/enums'
import { LOAN_STATUS_META, LOAN_STATUS_ORDER } from '../loanStatusMeta'
import { LoanStatusChip } from '../components/LoanStatusChip'
import { EmiDueChip } from '../components/EmiDueChip'
import { SortSelect } from '../components/SortSelect'

const routeApi = getRouteApi('/_authed/finances/')

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

// Server-side sort (mirrors the customers list). The backend default is
// created_at desc, which the SNO column reflects when no sort is in the URL.
const DEFAULT_SORT_FIELD: LoanSortField = 'created_at'
const DEFAULT_SORT_ORDER: SortOrder = 'desc'

// Headers in column order. `sortable` headers map to a backend LoanSortField;
// the rest (Loan ID, Mobile, REG No) are display-only.
interface ColumnHeader {
  label: string
  sortable: boolean
  field?: LoanSortField
  defaultDir?: SortOrder
}

const COLUMN_HEADERS: ReadonlyArray<ColumnHeader> = [
  { label: 'SNO', sortable: true, field: 'created_at', defaultDir: 'desc' },
  { label: 'Loan ID', sortable: false },
  { label: 'Customer Name', sortable: true, field: 'full_name', defaultDir: 'asc' },
  { label: 'Mobile', sortable: false },
  { label: 'Mandal/Village', sortable: true, field: 'mandal_village', defaultDir: 'asc' },
  { label: 'REG No', sortable: false },
  { label: 'Status', sortable: true, field: 'status', defaultDir: 'asc' },
]

// MUI hides the sort arrow on inactive columns and only fades it in on hover,
// which hides the "sortable" affordance. Pin it at reduced opacity so every
// sortable header advertises itself; the active column gets full opacity.
const sortLabelSx = {
  '& .MuiTableSortLabel-icon': { opacity: 0.4 },
  '&.Mui-active .MuiTableSortLabel-icon': { opacity: 1 },
} as const

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
    page,
    status,
    customer_id,
    search: searchTerm,
    sort_by,
    sort_order,
  } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const setSort = (next: { sort_by: LoanSortField; sort_order: SortOrder }) =>
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        sort_by: next.sort_by,
        sort_order: next.sort_order,
      }),
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
        search: (prev) => ({ ...prev, page: 1, search: next }),
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

  const query = useLoans({
    page,
    page_size: PAGE_SIZE,
    status,
    customer_id,
    search: searchTerm,
    include: 'customer,vehicle',
    sort_by,
    sort_order,
  })

  // Only to label the customer filter chip; cheap and cached.
  const customerQuery = useCustomer(customer_id)

  const total = query.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  const rows = query.data?.results ?? []

  const goToCreate = () => navigate({ to: '/finances/new', search: { step: 0 } })

  const setStatus = (next: LoanStatus | undefined) =>
    navigate({ search: (prev) => ({ ...prev, page: 1, status: next }) })

  const clearCustomer = () =>
    navigate({ search: (prev) => ({ ...prev, page: 1, customer_id: undefined }) })

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
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

        <Box sx={{ order: { xs: 2, sm: 3 }, width: { xs: '100%', sm: 'auto' } }}>
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
          <SortSelect sort_by={sort_by} sort_order={sort_order} onChange={setSort} />
        </Box>

        <Box sx={{ order: { xs: 3, sm: 4 }, width: '100%' }}>
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
              color={status ? 'default' : 'primary'}
              variant={status ? 'outlined' : 'filled'}
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

      {query.isError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={mapListError(query.error)} />
        </Box>
      )}

      {query.isLoading && !query.data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : (
        <>
          {rows.length === 0 ? (
            <EmptyState
              filtered={!!status || !!customer_id || !!searchTerm}
              onCreate={goToCreate}
            />
          ) : (
            <>
              <DesktopTable
                rows={rows}
                page={page}
                sort_by={sort_by}
                sort_order={sort_order}
                onSortChange={setSort}
              />
              <MobileCards rows={rows} page={page} />
            </>
          )}

          {total > 0 && (
            <Stack
              direction="row"
              spacing={2}
              sx={{
                mt: 3,
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Btn
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => navigate({ search: (prev) => ({ ...prev, page: page - 1 }) })}
              >
                ‹ Prev
              </Btn>
              <Typography variant="body2" color="text.secondary">
                Page {page} of {totalPages} · {total} finance{total === 1 ? '' : 's'}
              </Typography>
              <Btn
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })}
              >
                Next ›
              </Btn>
            </Stack>
          )}
        </>
      )}
    </Box>
  )
}

function serialNumber(page: number, index: number) {
  return (page - 1) * PAGE_SIZE + index + 1
}

// --------------------------------------------------
// Desktop table — md and up
// --------------------------------------------------

interface DesktopTableProps {
  rows: LoanResponse[]
  page: number
  sort_by: LoanSortField | undefined
  sort_order: SortOrder | undefined
  onSortChange: (next: { sort_by: LoanSortField; sort_order: SortOrder }) => void
}

function DesktopTable({ rows, page, sort_by, sort_order, onSortChange }: DesktopTableProps) {
  const navigate = routeApi.useNavigate()

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

  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {COLUMN_HEADERS.map((h) =>
                  h.sortable && h.field && h.defaultDir ? (
                    <TableCell
                      key={h.label}
                      sx={{ fontWeight: 600 }}
                      sortDirection={activeField === h.field ? activeOrder : false}
                    >
                      <TableSortLabel
                        active={activeField === h.field}
                        direction={activeField === h.field ? activeOrder : h.defaultDir}
                        onClick={() => handleHeaderClick(h.field!, h.defaultDir!)}
                        sx={sortLabelSx}
                      >
                        {h.label}
                      </TableSortLabel>
                    </TableCell>
                  ) : (
                    <TableCell key={h.label} sx={{ fontWeight: 600 }}>
                      {h.label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((l, i) => (
                <TableRow
                  key={l.id}
                  hover
                  onClick={() =>
                    navigate({ to: '/finances/$loanId', params: { loanId: l.id } })
                  }
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>{serialNumber(page, i)}</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                    {l.loan_number}
                  </TableCell>
                  <TableCell>{l.customer?.full_name ?? <Dash />}</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                    {l.customer?.mobile_number ?? <Dash />}
                  </TableCell>
                  <TableCell>{l.customer?.mandal_village ?? <Dash />}</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                    {l.vehicle?.plate_number ?? <Dash />}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      <LoanStatusChip status={l.status} />
                      <EmiDueChip status={l.emi_due_status} />
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  )
}

// --------------------------------------------------
// Mobile cards — below md
// --------------------------------------------------

function MobileCards({ rows, page }: { rows: LoanResponse[]; page: number }) {
  const navigate = routeApi.useNavigate()
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((l, i) => (
        <Card
          key={l.id}
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
              {l.loan_number}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <LoanStatusChip status={l.status} />
              <Typography variant="caption" color="text.secondary">
                #{serialNumber(page, i)}
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
      ))}
    </Stack>
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
