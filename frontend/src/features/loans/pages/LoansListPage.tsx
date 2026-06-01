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

import { useLoans, type LoanResponse } from '@/api/queries/loans'
import { useCustomer } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import type { LoanStatus } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { LOAN_STATUS_META, LOAN_STATUS_ORDER } from '../loanStatusMeta'
import { LoanStatusChip } from '../components/LoanStatusChip'

const routeApi = getRouteApi('/_authed/loans/')

const PAGE_SIZE = 20

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading loans.'
}

const Dash = () => (
  <Typography component="span" variant="body2" color="text.secondary">
    —
  </Typography>
)

export function LoansListPage() {
  const { page, status, customer_id } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const query = useLoans({
    page,
    page_size: PAGE_SIZE,
    status,
    customer_id,
    include: 'customer',
  })

  // Only to label the customer filter chip; cheap and cached.
  const customerQuery = useCustomer(customer_id)

  const total = query.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  const rows = query.data?.results ?? []

  const goToCreate = () => navigate({ to: '/loans/new' })

  const setStatus = (next: LoanStatus | undefined) =>
    navigate({ search: (prev) => ({ ...prev, page: 1, status: next }) })

  const clearCustomer = () =>
    navigate({ search: (prev) => ({ ...prev, page: 1, customer_id: undefined }) })

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2.5, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <Typography variant="h2" sx={{ flex: 1 }}>
          Loans
        </Typography>
        <Btn
          variant="primary"
          startIcon={<AddIcon />}
          onClick={goToCreate}
          sx={{ whiteSpace: 'nowrap' }}
        >
          New loan
        </Btn>
      </Stack>

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

      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 3, flexWrap: 'wrap', gap: 1, rowGap: 1 }}
      >
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
            <EmptyState filtered={!!status || !!customer_id} onCreate={goToCreate} />
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
                onClick={() => navigate({ search: (prev) => ({ ...prev, page: page - 1 }) })}
              >
                ‹ Prev
              </Btn>
              <Typography variant="body2" color="text.secondary">
                Page {page} of {totalPages} · {total} loan{total === 1 ? '' : 's'}
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

// --------------------------------------------------
// Desktop table — md and up
// --------------------------------------------------

function DesktopTable({ rows }: { rows: LoanResponse[] }) {
  const navigate = routeApi.useNavigate()
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Loan #</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">
                  Principal
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((l) => (
                <TableRow
                  key={l.id}
                  hover
                  onClick={() =>
                    navigate({ to: '/loans/$loanId', params: { loanId: l.id } })
                  }
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                    {l.loan_number}
                  </TableCell>
                  <TableCell>{l.customer?.full_name ?? <Dash />}</TableCell>
                  <TableCell align="right">{fmtINR(Number(l.principal))}</TableCell>
                  <TableCell>
                    <LoanStatusChip status={l.status} />
                  </TableCell>
                  <TableCell>{fmtDate(l.created_at)}</TableCell>
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

function MobileCards({ rows }: { rows: LoanResponse[] }) {
  const navigate = routeApi.useNavigate()
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((l) => (
        <Card
          key={l.id}
          onClick={() => navigate({ to: '/loans/$loanId', params: { loanId: l.id } })}
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
            <Typography variant="caption" color="text.secondary">
              {fmtDate(l.created_at)}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {l.customer?.full_name ?? <Dash />}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {fmtINR(Number(l.principal))}
            </Typography>
            <LoanStatusChip status={l.status} />
          </Stack>
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
          <Typography variant="h3">No matching loans</Typography>
          <Typography variant="body2" color="text.secondary">
            No loans match the current filters. Clear them to see all loans.
          </Typography>
        </Stack>
      </Card>
    )
  }
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">No loans yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Create your first loan as a draft, then approve it to generate the schedule.
        </Typography>
        <Btn variant="primary" startIcon={<AddIcon />} onClick={onCreate} sx={{ mt: 1 }}>
          New loan
        </Btn>
      </Stack>
    </Card>
  )
}
