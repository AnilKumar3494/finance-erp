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
import AddIcon from '@mui/icons-material/Add'

import { useCustomers, type CustomerResponse } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
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
  const { page, search: searchTerm } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

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

  const query = useCustomers({ page, page_size: PAGE_SIZE, search: searchTerm })

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
        spacing={2}
        sx={{ mb: 3, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <Box sx={{ flex: 1 }}>
          <Input
            id="customer-search"
            placeholder="Search by name, mobile, or assigned employee…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </Box>
        <Btn
          variant="primary"
          startIcon={<AddIcon />}
          onClick={goToCreate}
          sx={{ whiteSpace: 'nowrap' }}
        >
          New customer
        </Btn>
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
              <DesktopTable rows={rows} />
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

function DesktopTable({ rows }: { rows: CustomerResponse[] }) {
  const navigate = routeApi.useNavigate()
  const goToDetail = (id: string) =>
    navigate({ to: '/customers/$customerId', params: { customerId: id } })
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Mobile</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Assigned to</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
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
