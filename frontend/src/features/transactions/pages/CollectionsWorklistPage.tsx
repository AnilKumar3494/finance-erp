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
import AddIcon from '@mui/icons-material/AddOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardOutlined'

import {
  useDueCycleWorklist,
  type DueCycleWorklistItem,
  type WorklistParams,
} from '@/api/queries/dueCycles'
import {
  usePendingConfirmations,
  type PendingConfirmationItem,
} from '@/api/queries/transactions'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { CycleStatusChip } from '@/features/loans/components/CycleStatusChip'
import { RecordPaymentDialog } from '@/features/loans/components/RecordPaymentDialog'
import {
  WORKLIST_VIEWS,
  WORKLIST_VIEW_LABELS,
  viewToParams,
  type WorklistView,
} from '../worklistViews'

const routeApi = getRouteApi('/_authed/transactions')

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

const inr = (s: string) => fmtINR(Number(s))

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 404)
      return 'This worklist is unavailable — the backend endpoint may not be deployed yet.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading the worklist.'
}

export function CollectionsWorklistPage() {
  const { view, search: searchTerm, page } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const isConfirmations = view === 'confirmations'

  // Debounced URL search (cycle views only — the confirmations endpoint has no
  // search param).
  const [draft, setDraft] = useState(() => searchTerm ?? '')
  const isFirstRun = useRef(true)
  const lastWritten = useRef<string | undefined>(searchTerm)

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    const t = setTimeout(() => {
      const next = draft.trim() || undefined
      lastWritten.current = next
      navigate({ search: (prev) => ({ ...prev, page: 1, search: next }), replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft, navigate])

  useEffect(() => {
    if (searchTerm !== lastWritten.current) {
      lastWritten.current = searchTerm
      setDraft(searchTerm ?? '')
    }
  }, [searchTerm])

  const cycleParams: WorklistParams = {
    ...viewToParams(view),
    search: searchTerm,
    page,
    page_size: PAGE_SIZE,
  }
  const cycleQuery = useDueCycleWorklist(cycleParams)
  // Pending confirmations: fetch the active page when on that view, else page 1
  // — `total` is page-independent so the tab badge is correct either way.
  const pendingQuery = usePendingConfirmations(isConfirmations ? page : 1, PAGE_SIZE)
  const confirmationsCount = pendingQuery.data?.total ?? 0

  const [record, setRecord] = useState<DueCycleWorklistItem | null>(null)

  const activeQuery = isConfirmations ? pendingQuery : cycleQuery
  const total = activeQuery.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1

  const setView = (next: WorklistView) =>
    navigate({ search: (prev) => ({ ...prev, page: 1, view: next }), replace: true })

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
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
          Collections &amp; Actions
        </Typography>

        {!isConfirmations && (
          <Box
            sx={{
              order: { xs: 2, sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              flexGrow: { sm: 1 },
              minWidth: { sm: 220 },
            }}
          >
            <Input
              id="worklist-search"
              placeholder="Search by customer, mobile, or loan number…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
            />
          </Box>
        )}

        <Box
          sx={{
            order: { xs: 1, sm: 2 },
            width: { xs: '100%', sm: 'auto' },
            flexGrow: isConfirmations ? { sm: 1 } : undefined,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {WORKLIST_VIEWS.map((v) => {
              const selected = view === v
              const label =
                v === 'confirmations' && confirmationsCount > 0
                  ? `${WORKLIST_VIEW_LABELS[v]} (${confirmationsCount})`
                  : WORKLIST_VIEW_LABELS[v]
              return (
                <Chip
                  key={v}
                  label={label}
                  onClick={() => setView(v)}
                  color={selected ? 'primary' : v === 'confirmations' && confirmationsCount > 0 ? 'info' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ height: 36 }}
                />
              )
            })}
          </Stack>
        </Box>
      </Box>

      {activeQuery.isError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={mapListError(activeQuery.error)} />
        </Box>
      )}

      {activeQuery.isLoading && !activeQuery.data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : isConfirmations ? (
        (pendingQuery.data?.results.length ?? 0) === 0 ? (
          <ConfirmationsEmpty />
        ) : (
          <>
            <ConfirmationsDesktop rows={pendingQuery.data!.results} />
            <ConfirmationsMobile rows={pendingQuery.data!.results} />
          </>
        )
      ) : (cycleQuery.data?.results.length ?? 0) === 0 ? (
        <CyclesEmpty filtered={!!searchTerm} />
      ) : (
        <>
          <DesktopTable rows={cycleQuery.data!.results} onRecord={setRecord} />
          <MobileCards rows={cycleQuery.data!.results} onRecord={setRecord} />
        </>
      )}

      {total > 0 && (activeQuery.data?.results.length ?? 0) > 0 && (
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 3, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}
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
            Page {page} of {totalPages} · {total}{' '}
            {isConfirmations
              ? `payment${total === 1 ? '' : 's'} to confirm`
              : `cycle${total === 1 ? '' : 's'} due`}
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

      {record && (
        <RecordPaymentDialog
          loanId={record.loan_id}
          open={!!record}
          onClose={() => setRecord(null)}
          defaultCycleId={record.id}
          defaultAmount={record.shortfall}
        />
      )}
    </Box>
  )
}

function OverdueBadge({ days }: { days: number }) {
  if (days <= 0) return null
  return (
    <Typography component="span" variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
      {days}d overdue
    </Typography>
  )
}

// Small "money in flight" chip — a PENDING payment is already on this cycle.
function PendingChip({ count, total }: { count: number; total: string }) {
  if (count <= 0) return null
  return (
    <Chip
      size="small"
      color="info"
      variant="outlined"
      label={`${count} pending · ${inr(total)}`}
      sx={{ height: 20, mt: 0.5 }}
    />
  )
}

// --------------------------------------------------
// Cycle worklist (collect)
// --------------------------------------------------

function DesktopTable({
  rows,
  onRecord,
}: {
  rows: DueCycleWorklistItem[]
  onRecord: (row: DueCycleWorklistItem) => void
}) {
  const navigate = routeApi.useNavigate()
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Loan</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Cycle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Due</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Shortfall</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() =>
                    navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })
                  }
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {r.customer_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
                      {r.customer_mobile}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{r.loan_number}</TableCell>
                  <TableCell>#{r.cycle_number}</TableCell>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <span>{fmtDate(r.due_date)}</span>
                      <OverdueBadge days={r.days_overdue} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                    {inr(r.shortfall)}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0} sx={{ alignItems: 'flex-start' }}>
                      <CycleStatusChip status={r.cycle_status} />
                      <PendingChip count={r.pending_count} total={r.pending_total} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Btn
                      variant="primary"
                      size="sm"
                      startIcon={<AddIcon />}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRecord(r)
                      }}
                    >
                      Record
                    </Btn>
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

function MobileCards({
  rows,
  onRecord,
}: {
  rows: DueCycleWorklistItem[]
  onRecord: (row: DueCycleWorklistItem) => void
}) {
  const navigate = routeApi.useNavigate()
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((r) => (
        <Card
          key={r.id}
          onClick={() => navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })}
          sx={{ p: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        >
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {r.customer_name}
            </Typography>
            <CycleStatusChip status={r.cycle_status} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
            {r.customer_mobile} · {r.loan_number}
          </Typography>
          <Stack direction="row" sx={{ mt: 1, justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                #{r.cycle_number} · due {fmtDate(r.due_date)}
              </Typography>
              <OverdueBadge days={r.days_overdue} />
              <Box>
                <PendingChip count={r.pending_count} total={r.pending_total} />
              </Box>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'error.main' }}>
              {inr(r.shortfall)}
            </Typography>
          </Stack>
          <Box sx={{ mt: 1.5 }}>
            <Btn
              variant="primary"
              size="sm"
              startIcon={<AddIcon />}
              fullWidth
              onClick={(e) => {
                e.stopPropagation()
                onRecord(r)
              }}
            >
              Record payment
            </Btn>
          </Box>
        </Card>
      ))}
    </Stack>
  )
}

function CyclesEmpty({ filtered }: { filtered: boolean }) {
  return (
    <Card>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">Nothing to collect</Typography>
        <Typography variant="body2" color="text.secondary">
          {filtered
            ? 'No cycles match your search in this view.'
            : 'No due or overdue cycles in this view right now.'}
        </Typography>
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Confirmations (act) — pending payments awaiting confirm/fail
// --------------------------------------------------

function ConfirmationsDesktop({ rows }: { rows: PendingConfirmationItem[] }) {
  const navigate = routeApi.useNavigate()
  const open = (r: PendingConfirmationItem) =>
    navigate({
      to: '/finances/$loanId/collections',
      params: { loanId: r.loan_id },
      search: { focusTxn: r.id },
    })
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Loan</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Cycle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Paid on</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Recorded</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => open(r)}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {r.customer_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
                      {r.customer_mobile}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{r.loan_number}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{inr(r.amount)}</TableCell>
                  <TableCell>{r.cycle_number != null ? `#${r.cycle_number}` : '—'}</TableCell>
                  <TableCell>{fmtDate(r.effective_payment_date)}</TableCell>
                  <TableCell>{fmtDate(r.created_at)}</TableCell>
                  <TableCell align="right">
                    <Btn
                      variant="primary"
                      size="sm"
                      endIcon={<ArrowForwardIcon />}
                      onClick={(e) => {
                        e.stopPropagation()
                        open(r)
                      }}
                    >
                      Review
                    </Btn>
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

function ConfirmationsMobile({ rows }: { rows: PendingConfirmationItem[] }) {
  const navigate = routeApi.useNavigate()
  const open = (r: PendingConfirmationItem) =>
    navigate({
      to: '/finances/$loanId/collections',
      params: { loanId: r.loan_id },
      search: { focusTxn: r.id },
    })
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((r) => (
        <Card
          key={r.id}
          onClick={() => open(r)}
          sx={{ p: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        >
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {r.customer_name}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {inr(r.amount)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
            {r.customer_mobile} · {r.loan_number}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {r.cycle_number != null ? `Cycle #${r.cycle_number} · ` : ''}paid {fmtDate(r.effective_payment_date)} · recorded {fmtDate(r.created_at)}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <Btn variant="primary" size="sm" fullWidth endIcon={<ArrowForwardIcon />} onClick={(e) => { e.stopPropagation(); open(r) }}>
              Review
            </Btn>
          </Box>
        </Card>
      ))}
    </Stack>
  )
}

function ConfirmationsEmpty() {
  return (
    <Card>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">All caught up</Typography>
        <Typography variant="body2" color="text.secondary">
          No payments are waiting for confirmation right now.
        </Typography>
      </Stack>
    </Card>
  )
}
