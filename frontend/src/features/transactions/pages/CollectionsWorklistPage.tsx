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
  type WorklistSortField,
} from '@/api/queries/dueCycles'
import {
  usePendingConfirmations,
  type PendingConfirmationItem,
  type PendingSortField,
} from '@/api/queries/transactions'
import {
  useBadDebtProposals,
  type BadDebtProposalListItem,
  type BadDebtSortField,
} from '@/api/queries/badDebt'
import type { BadDebtProposalStatus } from '@/schemas/enums'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, type SortOrder, type SortState } from '@/components/sort/useTableSort'
import { fmtDate, fmtINR } from '@/lib/format'
import { CycleStatusChip } from '@/features/loans/components/CycleStatusChip'
import { loanDisplayId } from '@/features/loans/loanIdentity'
import { RecordPaymentDialog } from '@/features/loans/components/RecordPaymentDialog'
import {
  BadDebtReviewDialog,
  type BadDebtDecision,
} from '../components/BadDebtReviewDialog'
import {
  WORKLIST_VIEWS,
  WORKLIST_VIEW_LABELS,
  isCycleView,
  viewToParams,
  type WorklistView,
} from '../worklistViews'

const routeApi = getRouteApi('/_authed/transactions')

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

const inr = (s: string) => fmtINR(Number(s))

const CYCLE_SORT_OPTIONS: readonly SortOption<WorklistSortField>[] = [
  { value: 'due_date:asc', label: 'Due date (earliest)', sort_by: 'due_date', sort_order: 'asc' },
  { value: 'due_date:desc', label: 'Due date (latest)', sort_by: 'due_date', sort_order: 'desc' },
  { value: 'customer_name:asc', label: 'Customer (A → Z)', sort_by: 'customer_name', sort_order: 'asc' },
  { value: 'cycle_number:asc', label: 'Cycle (1 → N)', sort_by: 'cycle_number', sort_order: 'asc' },
  { value: 'cycle_status:asc', label: 'Status (A → Z)', sort_by: 'cycle_status', sort_order: 'asc' },
  { value: 'loan:asc', label: 'Loan (A → Z)', sort_by: 'loan', sort_order: 'asc' },
]

const PENDING_SORT_OPTIONS: readonly SortOption<PendingSortField>[] = [
  { value: 'created_at:asc', label: 'Recorded (oldest)', sort_by: 'created_at', sort_order: 'asc' },
  { value: 'created_at:desc', label: 'Recorded (newest)', sort_by: 'created_at', sort_order: 'desc' },
  { value: 'amount:desc', label: 'Amount (high → low)', sort_by: 'amount', sort_order: 'desc' },
  { value: 'effective_payment_date:desc', label: 'Paid on (newest)', sort_by: 'effective_payment_date', sort_order: 'desc' },
  { value: 'customer_name:asc', label: 'Customer (A → Z)', sort_by: 'customer_name', sort_order: 'asc' },
  { value: 'loan:asc', label: 'Loan (A → Z)', sort_by: 'loan', sort_order: 'asc' },
]

const BADDEBT_SORT_OPTIONS: readonly SortOption<BadDebtSortField>[] = [
  { value: 'proposed_at:desc', label: 'Proposed (newest)', sort_by: 'proposed_at', sort_order: 'desc' },
  { value: 'proposed_at:asc', label: 'Proposed (oldest)', sort_by: 'proposed_at', sort_order: 'asc' },
  { value: 'principal:desc', label: 'Principal (high → low)', sort_by: 'principal', sort_order: 'desc' },
  { value: 'customer_name:asc', label: 'Customer (A → Z)', sort_by: 'customer_name', sort_order: 'asc' },
  { value: 'loan:asc', label: 'Loan (A → Z)', sort_by: 'loan', sort_order: 'asc' },
]

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
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const isConfirmations = view === 'confirmations'
  const isBadDebt = view === 'baddebt'

  // The Bad debt lens is admin-only. If a non-admin reaches it (URL-hack or a
  // role change), bounce to the default cycle view so we never call the
  // admin-gated proposals endpoint for them.
  useEffect(() => {
    if (isBadDebt && user && !isAdmin) {
      navigate({ search: (prev) => ({ ...prev, page: 1, view: 'due' }), replace: true })
    }
  }, [isBadDebt, isAdmin, user, navigate])

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

  // Per-lens server-side sort. Each lens has its own columns, so it keeps its
  // own sort state. Changing a sort jumps back to page 1 (URL) so the user
  // lands on the top of the new ordering.
  const [cycleSort, setCycleSort] = useState<SortState<WorklistSortField>>({ sort_by: 'due_date', sort_order: 'asc' })
  const [pendingSort, setPendingSort] = useState<SortState<PendingSortField>>({ sort_by: 'created_at', sort_order: 'asc' })
  const [badDebtSort, setBadDebtSort] = useState<SortState<BadDebtSortField>>({ sort_by: 'proposed_at', sort_order: 'desc' })
  const resetPage = () => navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true })
  const onCycleSort = (f: WorklistSortField, d: SortOrder) => {
    setCycleSort((s) => toggleSort(s, f, d))
    resetPage()
  }
  const onPendingSort = (f: PendingSortField, d: SortOrder) => {
    setPendingSort((s) => toggleSort(s, f, d))
    resetPage()
  }
  const onBadDebtSort = (f: BadDebtSortField, d: SortOrder) => {
    setBadDebtSort((s) => toggleSort(s, f, d))
    resetPage()
  }

  const cycleParams: WorklistParams = {
    ...viewToParams(view),
    search: searchTerm,
    page,
    page_size: PAGE_SIZE,
    sort_by: cycleSort.sort_by,
    sort_order: cycleSort.sort_order,
  }
  const cycleQuery = useDueCycleWorklist(cycleParams)
  // Pending confirmations: fetch the active page when on that view, else page 1
  // — `total` is page-independent so the tab badge is correct either way.
  const pendingQuery = usePendingConfirmations(isConfirmations ? page : 1, PAGE_SIZE, pendingSort)
  const confirmationsCount = pendingQuery.data?.total ?? 0
  // Bad-debt proposals (admin-only). The chip badge always reflects the
  // pending (PROPOSED) count, regardless of which sub-tab is shown — so a
  // lightweight PROPOSED count query runs for any admin (deduped with the
  // table query when that's also PROPOSED page 1).
  const badDebtCountQuery = useBadDebtProposals(1, 'PROPOSED', isAdmin)
  const badDebtCount = badDebtCountQuery.data?.total ?? 0
  // The lens itself can show either the review queue (PROPOSED) or already-
  // approved proposals (so an admin can reopen/undo one). Local — reset to
  // page 1 on toggle.
  const [badDebtStatus, setBadDebtStatus] = useState<BadDebtProposalStatus>('PROPOSED')
  const badDebtQuery = useBadDebtProposals(
    isBadDebt ? page : 1,
    badDebtStatus,
    isAdmin && isBadDebt,
    badDebtSort,
  )

  const [record, setRecord] = useState<DueCycleWorklistItem | null>(null)
  const [review, setReview] = useState<{
    proposal: BadDebtProposalListItem
    decision: BadDebtDecision
  } | null>(null)

  const activeQuery = isBadDebt ? badDebtQuery : isConfirmations ? pendingQuery : cycleQuery
  const total = activeQuery.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1

  const setView = (next: WorklistView) =>
    navigate({ search: (prev) => ({ ...prev, page: 1, view: next }), replace: true })

  // Switch the Bad debt sub-tab (review queue vs approved) and reset paging.
  const setBadDebtTab = (next: BadDebtProposalStatus) => {
    setBadDebtStatus(next)
    navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true })
  }

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

        {isCycleView(view) && (
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
            flexGrow: isCycleView(view) ? undefined : { sm: 1 },
          }}
        >
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {WORKLIST_VIEWS
              // The Bad debt lens is admin-only — don't offer the chip otherwise.
              .filter((v) => v !== 'baddebt' || isAdmin)
              .map((v) => {
                const selected = view === v
                const badge =
                  v === 'confirmations' ? confirmationsCount : v === 'baddebt' ? badDebtCount : 0
                const label =
                  badge > 0 ? `${WORKLIST_VIEW_LABELS[v]} (${badge})` : WORKLIST_VIEW_LABELS[v]
                return (
                  <Chip
                    key={v}
                    label={label}
                    onClick={() => setView(v)}
                    color={selected ? 'primary' : badge > 0 ? 'info' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    sx={{ height: 36 }}
                  />
                )
              })}
          </Stack>
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
        {isBadDebt ? (
          <SortSelect
            options={BADDEBT_SORT_OPTIONS}
            sort_by={badDebtSort.sort_by}
            sort_order={badDebtSort.sort_order}
            onChange={(next) => {
              setBadDebtSort(next)
              resetPage()
            }}
            sx={{ width: '100%' }}
          />
        ) : isConfirmations ? (
          <SortSelect
            options={PENDING_SORT_OPTIONS}
            sort_by={pendingSort.sort_by}
            sort_order={pendingSort.sort_order}
            onChange={(next) => {
              setPendingSort(next)
              resetPage()
            }}
            sx={{ width: '100%' }}
          />
        ) : (
          <SortSelect
            options={CYCLE_SORT_OPTIONS}
            sort_by={cycleSort.sort_by}
            sort_order={cycleSort.sort_order}
            onChange={(next) => {
              setCycleSort(next)
              resetPage()
            }}
            sx={{ width: '100%' }}
          />
        )}
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
      ) : isBadDebt ? (
        <>
          <BadDebtSubtabs
            status={badDebtStatus}
            reviewCount={badDebtCount}
            onChange={setBadDebtTab}
          />
          {(badDebtQuery.data?.results.length ?? 0) === 0 ? (
            <BadDebtEmpty status={badDebtStatus} />
          ) : (
            <>
              <BadDebtDesktop
                rows={badDebtQuery.data!.results}
                onReview={(proposal, decision) => setReview({ proposal, decision })}
                sort={badDebtSort}
                onSort={onBadDebtSort}
              />
              <BadDebtMobile
                rows={badDebtQuery.data!.results}
                onReview={(proposal, decision) => setReview({ proposal, decision })}
              />
            </>
          )}
        </>
      ) : isConfirmations ? (
        (pendingQuery.data?.results.length ?? 0) === 0 ? (
          <ConfirmationsEmpty />
        ) : (
          <>
            <ConfirmationsDesktop rows={pendingQuery.data!.results} sort={pendingSort} onSort={onPendingSort} />
            <ConfirmationsMobile rows={pendingQuery.data!.results} />
          </>
        )
      ) : (cycleQuery.data?.results.length ?? 0) === 0 ? (
        <CyclesEmpty filtered={!!searchTerm} />
      ) : (
        <>
          <DesktopTable rows={cycleQuery.data!.results} onRecord={setRecord} sort={cycleSort} onSort={onCycleSort} />
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
            {isBadDebt
              ? badDebtStatus === 'APPROVED'
                ? `approved proposal${total === 1 ? '' : 's'}`
                : `proposal${total === 1 ? '' : 's'} to review`
              : isConfirmations
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

      <BadDebtReviewDialog
        proposal={review?.proposal ?? null}
        decision={review?.decision ?? 'APPROVE'}
        onClose={() => setReview(null)}
      />
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
  sort,
  onSort,
}: {
  rows: DueCycleWorklistItem[]
  onRecord: (row: DueCycleWorklistItem) => void
  sort: SortState<WorklistSortField>
  onSort: (field: WorklistSortField, defaultDir: SortOrder) => void
}) {
  const navigate = routeApi.useNavigate()
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 820, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <SortableTh field="customer_name" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="loan" label="Loan" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="cycle_number" label="Cycle" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="due_date" label="Due" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <TableCell sx={{ fontWeight: 600 }} align="right">Shortfall</TableCell>
                <SortableTh field="cycle_status" label="Status" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
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
                    navigate({
                      to: '/finances/$loanId/collections',
                      params: { loanId: r.loan_id },
                    })
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
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{loanDisplayId(r)}</TableCell>
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
          onClick={() =>
            navigate({
              to: '/finances/$loanId/collections',
              params: { loanId: r.loan_id },
            })
          }
          sx={{ p: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        >
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {r.customer_name}
            </Typography>
            <CycleStatusChip status={r.cycle_status} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
            {r.customer_mobile} · {loanDisplayId(r)}
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

function ConfirmationsDesktop({
  rows,
  sort,
  onSort,
}: {
  rows: PendingConfirmationItem[]
  sort: SortState<PendingSortField>
  onSort: (field: PendingSortField, defaultDir: SortOrder) => void
}) {
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
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 820, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <SortableTh field="customer_name" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="loan" label="Loan" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="amount" label="Amount" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                <TableCell sx={{ fontWeight: 600 }}>Cycle</TableCell>
                <SortableTh field="effective_payment_date" label="Paid on" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                <SortableTh field="created_at" label="Recorded" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
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
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{loanDisplayId(r)}</TableCell>
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
            {r.customer_mobile} · {loanDisplayId(r)}
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

// --------------------------------------------------
// Bad debt (review) — proposals awaiting approve/reject, or already-approved
// ones an admin can reopen (undo).
// --------------------------------------------------

type ReviewHandler = (
  proposal: BadDebtProposalListItem,
  decision: BadDebtDecision,
) => void

// Sub-tabs within the Bad debt lens: the review queue (PROPOSED) vs proposals
// already approved (where the only action is Reopen / undo).
function BadDebtSubtabs({
  status,
  reviewCount,
  onChange,
}: {
  status: BadDebtProposalStatus
  reviewCount: number
  onChange: (s: BadDebtProposalStatus) => void
}) {
  const tabs: { value: BadDebtProposalStatus; label: string }[] = [
    { value: 'PROPOSED', label: reviewCount > 0 ? `To review (${reviewCount})` : 'To review' },
    { value: 'APPROVED', label: 'Approved' },
  ]
  return (
    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
      {tabs.map((t) => (
        <Chip
          key={t.value}
          label={t.label}
          size="small"
          onClick={() => onChange(t.value)}
          color={status === t.value ? 'primary' : 'default'}
          variant={status === t.value ? 'filled' : 'outlined'}
          sx={{ height: 30 }}
        />
      ))}
    </Stack>
  )
}

function ReviewButtons({
  proposal,
  onReview,
  fullWidth,
}: {
  proposal: BadDebtProposalListItem
  onReview: ReviewHandler
  fullWidth?: boolean
}) {
  // An already-approved proposal offers only Reopen (undo the approval).
  if (proposal.status === 'APPROVED') {
    return (
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Btn
          variant="ghost"
          size="sm"
          fullWidth={fullWidth}
          onClick={(e) => {
            e.stopPropagation()
            onReview(proposal, 'REOPEN')
          }}
        >
          Reopen
        </Btn>
      </Stack>
    )
  }
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'flex-end', '& .MuiButton-root': { whiteSpace: 'nowrap' } }}
    >
      <Btn
        variant="success"
        size="sm"
        fullWidth={fullWidth}
        onClick={(e) => {
          e.stopPropagation()
          onReview(proposal, 'APPROVE')
        }}
      >
        Approve
      </Btn>
      <Btn
        variant="danger"
        size="sm"
        fullWidth={fullWidth}
        onClick={(e) => {
          e.stopPropagation()
          onReview(proposal, 'REJECT')
        }}
      >
        Reject
      </Btn>
    </Stack>
  )
}

function BadDebtDesktop({
  rows,
  onReview,
  sort,
  onSort,
}: {
  rows: BadDebtProposalListItem[]
  onReview: ReviewHandler
  sort: SortState<BadDebtSortField>
  onSort: (field: BadDebtSortField, defaultDir: SortOrder) => void
}) {
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 820 }}>
            <TableHead>
              <TableRow sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                <SortableTh field="customer_name" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="loan" label="Loan" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                <SortableTh field="principal" label="Principal" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                <SortableTh field="proposed_at" label="Proposed" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                <TableCell sx={{ fontWeight: 600 }} align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {r.customer_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
                      {r.customer_mobile}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {loanDisplayId(r)}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{inr(r.principal)}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography
                      variant="body2"
                      sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={r.proposed_reason}
                    >
                      {r.auto_proposed ? '⚙ ' : ''}{r.proposed_reason}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(r.proposed_at)}</TableCell>
                  <TableCell align="right">
                    <ReviewButtons proposal={r} onReview={onReview} />
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

function BadDebtMobile({
  rows,
  onReview,
}: {
  rows: BadDebtProposalListItem[]
  onReview: ReviewHandler
}) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((r) => (
        <Card key={r.id} sx={{ p: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {r.customer_name}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {inr(r.principal)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
            {r.customer_mobile} · {loanDisplayId(r)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>
            {r.auto_proposed ? '⚙ ' : ''}{r.proposed_reason}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Proposed {fmtDate(r.proposed_at)}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <ReviewButtons proposal={r} onReview={onReview} fullWidth />
          </Box>
        </Card>
      ))}
    </Stack>
  )
}

function BadDebtEmpty({ status }: { status: BadDebtProposalStatus }) {
  const approved = status === 'APPROVED'
  return (
    <Card>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">
          {approved ? 'No approved proposals' : 'No proposals to review'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {approved
            ? 'No bad-debt proposals have been approved yet.'
            : 'No loans are awaiting a bad-debt decision right now.'}
        </Typography>
      </Stack>
    </Card>
  )
}
