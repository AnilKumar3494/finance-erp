import { useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
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
import TableSortLabel from '@mui/material/TableSortLabel'
import AddIcon from '@mui/icons-material/Add'

import {
  useCustomers,
  type CustomerResponse,
  type CustomerSortField,
  type SortOrder,
} from '@/api/queries/customers'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { SortSelect } from '@/features/customers/components/SortSelect'
import { fmtDate } from '@/lib/format'

const routeApi = getRouteApi('/_authed/customers/')

const PAGE_SIZE = 20
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
    page,
    search: searchTerm,
    sort_by,
    sort_order,
  } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const setSort = (next: { sort_by: CustomerSortField; sort_order: SortOrder }) =>
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        sort_by: next.sort_by,
        sort_order: next.sort_order,
      }),
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
        search: (prev) => ({ ...prev, page: 1, search: next }),
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

  const query = useCustomers({
    page,
    page_size: PAGE_SIZE,
    search: searchTerm,
    sort_by,
    sort_order,
  })

  const total = query.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  const rows = query.data?.results ?? []

  const goToCreate = () => navigate({ to: '/customers/new' })

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      {/* AKK-LATER-TODO: metrics dashboard above the search row — totals,
          active loans count, overdue cycles, customers added this month, etc.
          Needs a backend aggregate endpoint and a small Stat-tile primitive. */}
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
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
        >
          <SortSelect
            sort_by={sort_by}
            sort_order={sort_order}
            onChange={setSort}
          />
          <Btn
            variant="primary"
            startIcon={<AddIcon />}
            onClick={goToCreate}
            sx={{ whiteSpace: 'nowrap' }}
          >
            New customer
          </Btn>
        </Stack>
      </Stack>

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
            <EmptyState searchTerm={searchTerm} onCreate={goToCreate} />
          ) : (
            <>
              <DesktopTable
                rows={rows}
                sort_by={sort_by}
                sort_order={sort_order}
                onSortChange={setSort}
              />
              <MobileCards rows={rows} />
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
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, page: page - 1 }) })
                }
              >
                ‹ Prev
              </Btn>
              <Typography variant="body2" color="text.secondary">
                Page {page} of {totalPages} · {total} customer{total === 1 ? '' : 's'}
              </Typography>
              <Btn
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })
                }
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

// --------------------------------------------------
// Desktop table — md and up
// --------------------------------------------------

interface DesktopTableProps {
  rows: CustomerResponse[]
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

// MUI hides the sort arrow on inactive columns by default and only fades
// it in on hover, which makes the "this column is sortable" affordance
// invisible until you mouse over it. Pin the icon at reduced opacity so
// every sortable header advertises itself; the active column still gets
// full opacity for emphasis.
const sortLabelSx = {
  '& .MuiTableSortLabel-icon': { opacity: 0.4 },
  '&.Mui-active .MuiTableSortLabel-icon': { opacity: 1 },
} as const

function DesktopTable({ rows, sort_by, sort_order, onSortChange }: DesktopTableProps) {
  const navigate = routeApi.useNavigate()
  const goToDetail = (id: string) =>
    navigate({ to: '/customers/$customerId', params: { customerId: id } })

  // Clicking the active column flips the direction. Clicking an inactive
  // column applies that field's default direction (asc for names, desc
  // for created).
  const handleHeaderClick = (
    field: CustomerSortField,
    defaultDir: SortOrder,
  ) => {
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

  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {COLUMN_HEADERS.map((h) =>
                  h.sortable && h.field && h.defaultDir ? (
                    <TableCell key={h.label} sx={{ fontWeight: 600 }}>
                      <TableSortLabel
                        active={activeField === h.field}
                        direction={
                          activeField === h.field ? activeOrder : h.defaultDir
                        }
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
              {rows.map((c) => (
                <TableRow
                  key={c.id}
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

function MobileCards({ rows }: { rows: CustomerResponse[] }) {
  const navigate = routeApi.useNavigate()
  const goToDetail = (id: string) =>
    navigate({ to: '/customers/$customerId', params: { customerId: id } })
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((c) => (
        <Card
          key={c.id}
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
            <Typography variant="caption" color="text.secondary">
              {fmtDate(c.created_at)}
            </Typography>
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
      ))}
    </Stack>
  )
}

// --------------------------------------------------
// Empty state
// --------------------------------------------------

interface EmptyStateProps {
  searchTerm: string | undefined
  onCreate: () => void
}

function EmptyState({ searchTerm, onCreate }: EmptyStateProps) {
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
