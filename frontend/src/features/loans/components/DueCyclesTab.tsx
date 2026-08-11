import { useState } from 'react'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import {
  useDueCycles,
  useClassifyCycle,
  useReclassifyCycle,
  type DueCycleResponse,
} from '@/api/queries/dueCycles'
import { useLoanTransactions } from '@/api/queries/transactions'
import type { LoanResponse } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortOrder, type SortState } from '@/components/sort/useTableSort'
import type { CycleStatus } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { deriveCycleDisplay, type CycleDisplay } from '../cycleDisplay'
import { deriveNetDue, type CycleNetDue } from '../cycleNetDue'
import { focusTransaction } from '../txnFocus'
import { CycleStatusChip } from './CycleStatusChip'
import { RecordPaymentDialog } from './RecordPaymentDialog'

// Net due is a derived waterfall value (computed after the data hooks) and
// shows text states, so it's not a client-sort key; every other column is.
type CycleField = 'cycle' | 'due' | 'total_due' | 'received' | 'shortfall' | 'penalty' | 'status'

const CYCLE_ACCESSORS: Partial<Record<CycleField, (c: DueCycleResponse) => string | number | null>> = {
  cycle: (c) => c.cycle_number,
  due: (c) => c.due_date,
  total_due: (c) => Number(c.total_due),
  received: (c) => Number(c.total_received),
  shortfall: (c) => Number(c.shortfall),
  penalty: (c) => Number(c.penalty_amount),
  status: (c) => c.cycle_status,
}

const CYCLE_SORT_OPTIONS: readonly SortOption<CycleField>[] = [
  { value: 'cycle:asc', label: 'Cycle (1 → N)', sort_by: 'cycle', sort_order: 'asc' },
  { value: 'cycle:desc', label: 'Cycle (N → 1)', sort_by: 'cycle', sort_order: 'desc' },
  { value: 'due:asc', label: 'Due date (earliest)', sort_by: 'due', sort_order: 'asc' },
  { value: 'due:desc', label: 'Due date (latest)', sort_by: 'due', sort_order: 'desc' },
  { value: 'shortfall:desc', label: 'Shortfall (high → low)', sort_by: 'shortfall', sort_order: 'desc' },
  { value: 'status:asc', label: 'Status (A → Z)', sort_by: 'status', sort_order: 'asc' },
]

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 403) return 'You do not have access to this schedule.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading the schedule.'
}

function amountOrDash(value: string) {
  return Number(value) > 0 ? fmtINR(Number(value)) : null
}

// A cycle is open for classification only when awaiting review; an already
// classified one can be re-classified (override).
function classifyMode(status: CycleStatus): 'classify' | 'reclassify' | null {
  if (status === 'AWAITING_REVIEW') return 'classify'
  if (status === 'PAID_ON_TIME' || status === 'LATE_PAYMENT' || status === 'MISSED_CAPPED')
    return 'reclassify'
  return null
}

export function DueCyclesTab({ loan }: { loan: LoanResponse }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const payable = loan.status === 'ACTIVE' || loan.status === 'AWAITING_CLOSURE'

  const query = useDueCycles(loan.id)
  // Shared cache with TransactionsTab — used to derive richer cycle display
  // states (Pending confirmation / Paid in advance) that the raw cycle_status
  // doesn't surface. See cycleDisplay.ts for the rules.
  const txnsQuery = useLoanTransactions(loan.id, loan.status !== 'DRAFT')
  const [record, setRecord] = useState<{ cycleId: string; amount: string } | null>(null)
  const [classify, setClassify] = useState<{ cycle: DueCycleResponse; mode: 'classify' | 'reclassify' } | null>(null)

  // Client-side sort over this loan's already-loaded cycles. Computed before
  // the early returns so the hook order stays stable.
  const [sort, setSort] = useState<SortState<CycleField>>({ sort_by: 'cycle', sort_order: 'asc' })
  const onSort = (field: CycleField, defaultDir: SortOrder) =>
    setSort((s) => toggleSort(s, field, defaultDir))
  const sortedRows = useClientSort(query.data?.results ?? [], sort.sort_by, sort.sort_order, CYCLE_ACCESSORS)

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (query.isError) {
    return <ErrorBanner message={mapError(query.error)} />
  }

  const rows = sortedRows
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No due cycles yet. They are generated when the loan is approved.
      </Typography>
    )
  }

  // Transactions feed two things, sharing one cached query with
  // TransactionsTab: the richer chip display, and the net-due waterfall pool
  // (Σ SUCCESS = the loan's total paid).
  const txns = txnsQuery.data?.results ?? []
  const totalPaid = txns
    .filter((t) => t.status === 'SUCCESS' && !t.is_deleted)
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const netDueByCycleId = deriveNetDue(rows, totalPaid)

  const onRecord = (c: DueCycleResponse) => {
    // Seed the dialog with the genuinely-owed amount (net of carried-forward
    // credit), not the raw per-cycle shortfall.
    const net = netDueByCycleId.get(c.id)?.netDue ?? 0
    setRecord({ cycleId: c.id, amount: net > 0 ? net.toFixed(2) : '' })
  }

  const actions = {
    payable,
    isAdmin,
    onRecord,
    onClassify: (c: DueCycleResponse) => {
      const mode = classifyMode(c.cycle_status)
      if (mode) setClassify({ cycle: c, mode })
    },
  }

  const showActions = payable || isAdmin

  // "Recovery stale" — a late cycle whose deficit was spread forward (resolved)
  // but which has since received a SUCCESS payment recorded AFTER it was
  // classified. The spread was frozen at classification, so that payment isn't
  // reflected in the schedule yet: the admin must reclassify to apply it. We
  // surface a nudge on the row instead of leaving the payment silently stranded.
  const staleCycleIds = new Set<string>()
  for (const c of rows) {
    if (!netDueByCycleId.get(c.id)?.resolved || !c.classified_at) continue
    const classifiedAt = new Date(c.classified_at).getTime()
    const hasPostClassPayment = txns.some(
      (t) =>
        !t.is_deleted &&
        t.status === 'SUCCESS' &&
        t.due_cycle_id === c.id &&
        new Date(t.created_at).getTime() > classifiedAt,
    )
    if (hasPostClassPayment) staleCycleIds.add(c.id)
  }

  // Build display state per cycle once so both the desktop table and the
  // mobile cards render the same chip without re-deriving.
  const displayByCycleId = new Map<string, CycleDisplay>(
    rows.map((c) => [c.id, deriveCycleDisplay(c, txns)]),
  )
  // Clicking a "Pending confirmation" chip jumps to the awaiting transaction.
  // The transaction row in TransactionsTab listens to focusTransaction; the
  // parent CollapsibleCard (in loan detail) also listens so it auto-expands
  // if it was collapsed. The cockpit page mounts both tabs unconditionally,
  // so the listener fires there too.
  const onChipClick = (d: CycleDisplay) => {
    if (d.pendingTxnId) focusTransaction(d.pendingTxnId)
  }

  return (
    <>
      <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
        <SortSelect
          options={CYCLE_SORT_OPTIONS}
          sort_by={sort.sort_by}
          sort_order={sort.sort_order}
          onChange={setSort}
          sx={{ width: '100%' }}
        />
      </Box>
      <DesktopTable
        rows={rows}
        actions={actions}
        showActions={showActions}
        displayByCycleId={displayByCycleId}
        netDueByCycleId={netDueByCycleId}
        staleCycleIds={staleCycleIds}
        onChipClick={onChipClick}
        sort={sort}
        onSort={onSort}
      />
      <MobileCards
        rows={rows}
        actions={actions}
        showActions={showActions}
        displayByCycleId={displayByCycleId}
        netDueByCycleId={netDueByCycleId}
        staleCycleIds={staleCycleIds}
        onChipClick={onChipClick}
      />

      <RecordPaymentDialog
        loanId={loan.id}
        open={record != null}
        onClose={() => setRecord(null)}
        defaultCycleId={record?.cycleId ?? ''}
        defaultAmount={record?.amount ?? ''}
      />
      <ClassifyCycleDialog
        loanId={loan.id}
        cycle={classify?.cycle ?? null}
        mode={classify?.mode ?? 'classify'}
        onClose={() => setClassify(null)}
      />
    </>
  )
}

interface CycleActions {
  payable: boolean
  isAdmin: boolean
  onRecord: (c: DueCycleResponse) => void
  onClassify: (c: DueCycleResponse) => void
}

function CycleActionButtons({
  cycle,
  actions,
  net,
  stale,
}: {
  cycle: DueCycleResponse
  actions: CycleActions
  net?: CycleNetDue
  stale?: boolean
}) {
  const mode = classifyMode(cycle.cycle_status)
  // Hide per-cycle Record once nothing is genuinely owed for this cycle. We
  // gate on NET due, not the raw shortfall: a cycle covered by carried-forward
  // credit, or a late cycle whose deficit was rolled into later EMIs, has a
  // non-zero raw shortfall but nothing left to collect here. Showing Record on
  // those let admins double-pay the same money. The header Record button still
  // covers any deliberate extra payment.
  const owed = net ? net.netDue : Number(cycle.shortfall)
  const showRecord = actions.payable && owed > 0
  // Highlight Classify (primary) when it's a fresh action-needed state. A stale
  // cycle (an unapplied payment is waiting on a reclassify) also gets the
  // primary call-to-action; otherwise Reclassify stays a quiet ghost override.
  const classifyVariant = mode === 'classify' || stale ? 'primary' : 'ghost'
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        rowGap: 0.5,
        '& .MuiButton-root': { whiteSpace: 'nowrap', minWidth: 'auto' },
      }}
    >
      {showRecord && (
        <Btn variant="ghost" size="sm" onClick={() => actions.onRecord(cycle)}>
          Record payment
        </Btn>
      )}
      {actions.isAdmin && mode && (
        <Btn variant={classifyVariant} size="sm" onClick={() => actions.onClassify(cycle)}>
          {mode === 'classify' ? 'Classify' : stale ? 'Reclassify to apply' : 'Reclassify'}
        </Btn>
      )}
    </Stack>
  )
}

const Dash = () => (
  <Typography component="span" variant="body2" color="text.secondary">
    —
  </Typography>
)

function NetDueValue({ net, stale }: { net?: CycleNetDue; stale?: boolean }) {
  // A stale resolved cycle has an unapplied payment — flag it as an action,
  // not a calm "Recovered".
  if (stale) {
    return (
      <Typography component="span" variant="body2" color="warning.main" sx={{ fontWeight: 600 }}>
        Reclassify to apply
      </Typography>
    )
  }
  if (net?.resolved) {
    const capped = net.resolvedKind === 'capped'
    return (
      <Typography
        component="span"
        variant="body2"
        color={capped ? 'error.main' : 'success.main'}
      >
        {capped ? 'Bad debt' : 'Recovered'}
      </Typography>
    )
  }
  return (
    <Typography component="span" variant="body2">
      {fmtINR(net?.netDue ?? 0)}
    </Typography>
  )
}

function DesktopTable({
  rows,
  actions,
  showActions,
  displayByCycleId,
  netDueByCycleId,
  staleCycleIds,
  onChipClick,
  sort,
  onSort,
}: {
  rows: DueCycleResponse[]
  actions: CycleActions
  showActions: boolean
  displayByCycleId: Map<string, CycleDisplay>
  netDueByCycleId: Map<string, CycleNetDue>
  staleCycleIds: Set<string>
  onChipClick: (d: CycleDisplay) => void
  sort: SortState<CycleField>
  onSort: (field: CycleField, defaultDir: SortOrder) => void
}) {
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <TableContainer>
        <Table
          size="small"
          sx={{
            '& .MuiTableCell-root': { whiteSpace: 'nowrap' },
            '& .MuiChip-root': { minWidth: 140, justifyContent: 'center' },
          }}
        >
          <TableHead>
            <TableRow>
              <SortableTh field="cycle" label="#" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <SortableTh field="due" label="Due date" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <SortableTh field="total_due" label="Total due" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <SortableTh field="received" label="Received" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <TableCell sx={{ fontWeight: 600 }} align="right">Net due</TableCell>
              <SortableTh field="shortfall" label="Shortfall" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <SortableTh field="penalty" label="Penalty" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <SortableTh field="status" label="Status" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              {showActions && <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((c) => {
              const shortfall = amountOrDash(c.shortfall)
              const penalty = amountOrDash(c.penalty_amount)
              return (
                <TableRow key={c.id}>
                  <TableCell>{c.cycle_number}</TableCell>
                  <TableCell>{fmtDate(c.due_date)}</TableCell>
                  <TableCell align="right">{fmtINR(Number(c.total_due))}</TableCell>
                  <TableCell align="right">{fmtINR(Number(c.total_received))}</TableCell>
                  <TableCell align="right">
                    <NetDueValue net={netDueByCycleId.get(c.id)} stale={staleCycleIds.has(c.id)} />
                  </TableCell>
                  <TableCell align="right" sx={{ color: shortfall ? 'error.main' : undefined }}>
                    {shortfall ?? <Dash />}
                  </TableCell>
                  <TableCell align="right">{penalty ?? <Dash />}</TableCell>
                  <TableCell>
                    {(() => {
                      const display = displayByCycleId.get(c.id) ?? {
                        key: c.cycle_status,
                      }
                      return (
                        <CycleStatusChip
                          display={display}
                          onClick={display.pendingTxnId ? onChipClick : undefined}
                        />
                      )
                    })()}
                  </TableCell>
                  {showActions && (
                    <TableCell align="right">
                      <CycleActionButtons
                        cycle={c}
                        actions={actions}
                        net={netDueByCycleId.get(c.id)}
                        stale={staleCycleIds.has(c.id)}
                      />
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

function MobileCards({
  rows,
  actions,
  showActions,
  displayByCycleId,
  netDueByCycleId,
  staleCycleIds,
  onChipClick,
}: {
  rows: DueCycleResponse[]
  actions: CycleActions
  showActions: boolean
  displayByCycleId: Map<string, CycleDisplay>
  netDueByCycleId: Map<string, CycleNetDue>
  staleCycleIds: Set<string>
  onChipClick: (d: CycleDisplay) => void
}) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((c) => {
        const shortfall = amountOrDash(c.shortfall)
        const net = netDueByCycleId.get(c.id)
        const stale = staleCycleIds.has(c.id)
        return (
          <Box
            key={c.id}
            sx={{
              p: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Cycle {c.cycle_number} · {fmtDate(c.due_date)}
              </Typography>
              {(() => {
                const display = displayByCycleId.get(c.id) ?? {
                  key: c.cycle_status,
                }
                return (
                  <CycleStatusChip
                    display={display}
                    onClick={display.pendingTxnId ? onChipClick : undefined}
                  />
                )
              })()}
            </Stack>
            <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <LabelValue label="Due" value={fmtINR(Number(c.total_due))} />
              <LabelValue label="Received" value={fmtINR(Number(c.total_received))} />
              <LabelValue
                label="Net due"
                value={
                  stale
                    ? 'Reclassify to apply'
                    : net?.resolved
                      ? net.resolvedKind === 'capped'
                        ? 'Bad debt'
                        : 'Recovered'
                      : fmtINR(net?.netDue ?? 0)
                }
                danger={stale}
              />
              {shortfall && <LabelValue label="Shortfall" value={shortfall} danger />}
            </Stack>
            {showActions && (
              <Box sx={{ mt: 1.5 }}>
                <CycleActionButtons cycle={c} actions={actions} net={net} stale={stale} />
              </Box>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}

function LabelValue({
  label,
  value,
  danger = false,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: danger ? 'error.main' : undefined }}>
        {value}
      </Typography>
    </Box>
  )
}

// --------------------------------------------------
// Classify / reclassify a cycle's punctuality (admin)
// --------------------------------------------------

const CLASSIFY_OPTIONS: { value: CycleStatus; label: string }[] = [
  { value: 'PAID_ON_TIME', label: 'Paid on time' },
  { value: 'LATE_PAYMENT', label: 'Late payment' },
]

function mapClassifyError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (detail) return detail
    if (error.response?.status === 403) return 'You do not have permission to classify this cycle.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not classify this cycle. Please try again.'
}

function ClassifyCycleDialog({
  loanId,
  cycle,
  mode,
  onClose,
}: {
  loanId: string
  cycle: DueCycleResponse | null
  mode: 'classify' | 'reclassify'
  onClose: () => void
}) {
  const classify = useClassifyCycle(loanId)
  const reclassify = useReclassifyCycle(loanId)
  const mutation = mode === 'classify' ? classify : reclassify

  const [status, setStatus] = useState<CycleStatus>('PAID_ON_TIME')
  const [note, setNote] = useState('')
  // The backend requires an "as of" date when marking a cycle LATE_PAYMENT.
  const [asOf, setAsOf] = useState<Dayjs | null>(dayjs())

  // Re-seed when a new cycle is opened.
  const openFor = cycle?.id
  const seedKey = `${openFor}-${mode}`
  const [seeded, setSeeded] = useState<string | null>(null)
  if (cycle && seeded !== seedKey) {
    setSeeded(seedKey)
    setStatus(
      cycle.cycle_status === 'LATE_PAYMENT' ? 'LATE_PAYMENT' : 'PAID_ON_TIME',
    )
    setNote(cycle.classification_note ?? '')
    setAsOf(cycle.classified_as_of_date ? dayjs(cycle.classified_as_of_date) : dayjs())
    mutation.reset()
  }

  const close = () => {
    if (mutation.isPending) return
    onClose()
  }

  // LATE_PAYMENT requires an as-of date at all. Separately, ANY status must
  // reject a half-typed one: the picker hands back a non-null invalid Dayjs
  // mid-keystroke, which would post the string "Invalid Date".
  const asOfInvalid = asOf !== null && !asOf.isValid()
  const lateNeedsDate = status === 'LATE_PAYMENT' && (asOf == null || asOfInvalid)
  const dateBlocked = lateNeedsDate || asOfInvalid

  const submit = () => {
    if (!cycle || dateBlocked) return
    mutation.mutate(
      {
        cycleId: cycle.id,
        payload: {
          cycle_status: status,
          // Required for LATE_PAYMENT; harmless (an override) for PAID_ON_TIME.
          classified_as_of_date: asOf ? asOf.format('YYYY-MM-DD') : undefined,
          classification_note: note.trim() || undefined,
        },
      },
      { onSuccess: () => onClose() },
    )
  }

  const error = mutation.isError ? mapClassifyError(mutation.error) : null

  return (
    <Dialog open={cycle != null} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {mode === 'classify' ? 'Classify cycle' : 'Reclassify cycle'}
        {cycle ? ` #${cycle.cycle_number}` : ''}
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2.5}>
          {error && <ErrorBanner message={error} />}
          <Input
            select
            id="cls_status"
            label="Punctuality"
            required
            value={status}
            onChange={(e) => setStatus(e.target.value as CycleStatus)}
          >
            {CLASSIFY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Input>
          <Box>
            <FieldLabel htmlFor="cls_asof" required={status === 'LATE_PAYMENT'}>
              Classified as of date
            </FieldLabel>
            <DatePicker
              value={asOf}
              onChange={(d) => setAsOf(d)}
              format="DD MMM YYYY"
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  id: 'cls_asof',
                  size: 'small',
                  fullWidth: true,
                  error: dateBlocked,
                },
              }}
            />
            {status === 'LATE_PAYMENT' && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Required for a late payment.
              </Typography>
            )}
          </Box>
          <Input
            id="cls_note"
            label="Note"
            placeholder="Optional"
            multiline
            minRows={2}
            maxRows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          pb: 2.5,
          pt: 1,
          gap: 1,
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          '& > :not(:first-of-type)': { ml: 0 },
          '& > button': { width: { xs: '100%', sm: 'auto' } },
        }}
      >
        <Btn variant="ghost" onClick={close} disabled={mutation.isPending}>
          Cancel
        </Btn>
        <Btn variant="primary" onClick={submit} loading={mutation.isPending} disabled={dateBlocked}>
          {mode === 'classify' ? 'Classify' : 'Reclassify'}
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
