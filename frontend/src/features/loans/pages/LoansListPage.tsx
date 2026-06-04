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
import { LOAN_STATUS_META, LOAN_STATUS_ORDER } from '../loanStatusMeta'
import { LoanStatusChip } from '../components/LoanStatusChip'

const routeApi = getRouteApi('/_authed/finances/')

const PAGE_SIZE = 20

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
  const { page, status, customer_id } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const query = useLoans({
    page,
    page_size: PAGE_SIZE,
    status,
    customer_id,
    include: 'customer,vehicle',
  })

  // Only to label the customer filter chip; cheap and cached.
  const customerQuery = useCustomer(customer_id)

  const total = query.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  const rows = query.data?.results ?? []

  const goToCreate = () => navigate({ to: '/finances/new' })

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
          Finances
        </Typography>
        <Btn
          variant="primary"
          startIcon={<AddIcon />}
          onClick={goToCreate}
          sx={{ whiteSpace: 'nowrap' }}
        >
          New finance
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
              <DesktopTable rows={rows} page={page} />
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

function DesktopTable({ rows, page }: { rows: LoanResponse[]; page: number }) {
  const navigate = routeApi.useNavigate()
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>SNO</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Loan ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Customer Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Mobile</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>REG No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
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
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                    {l.vehicle?.plate_number ?? <Dash />}
                  </TableCell>
                  <TableCell>
                    <LoanStatusChip status={l.status} />
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
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {l.customer?.full_name ?? <Dash />}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.25, fontFamily: 'var(--font-mono)' }}
          >
            {l.customer?.mobile_number ?? '—'} · REG {l.vehicle?.plate_number ?? '—'}
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
