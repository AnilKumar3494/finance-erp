import { useEffect, useMemo, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import type { ChipProps } from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import AddIcon from '@mui/icons-material/AddOutlined'
import ReceiptIcon from '@mui/icons-material/ReceiptLongOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditNoteIcon from '@mui/icons-material/EditOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined'
import UndoIcon from '@mui/icons-material/UndoOutlined'

import {
  useLoanTransactions,
  useLoanSummary,
  useConfirmTransaction,
  useFailTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useRestoreTransaction,
  type TransactionResponse,
} from '@/api/queries/transactions'
import { useDueCycles, type DueCycleResponse } from '@/api/queries/dueCycles'
import type { LoanResponse } from '@/api/queries/loans'
import { useFinancePermissions } from '../financePermissions'
import { useTransactionFocus } from '../txnFocus'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, Spinner } from '@/components/primitives'
import { SortSelect, type SortOption } from '@/components/sort/SortSelect'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortOrder, type SortState } from '@/components/sort/useTableSort'
import type { TransactionStatus, TransactionType } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { EditTransactionDialog } from './EditTransactionDialog'

const TXN_STATUS_META: Record<
  TransactionStatus,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  PENDING: { label: 'Pending', color: 'warning' },
  SUCCESS: { label: 'Success', color: 'success' },
  FAILED: { label: 'Failed', color: 'error' },
}

const TXN_TYPE_LABELS: Record<TransactionType, string> = {
  REGULAR: 'Regular',
  DOWN_PAYMENT: 'Down payment',
}

// How long a just-deleted row stays in place offering Restore. The delete is a
// soft delete, so the record survives either way — this is only how long the
// undo stays within reach before the row leaves the list. An admin can still
// restore it afterwards from the record itself.
const UNDO_WINDOW_MS = 6000

type TxnField = 'date' | 'amount' | 'mode' | 'cycle' | 'type' | 'status'

const TXN_SORT_OPTIONS: readonly SortOption<TxnField>[] = [
  { value: 'date:desc', label: 'Date (newest)', sort_by: 'date', sort_order: 'desc' },
  { value: 'date:asc', label: 'Date (oldest)', sort_by: 'date', sort_order: 'asc' },
  { value: 'amount:desc', label: 'Amount (high → low)', sort_by: 'amount', sort_order: 'desc' },
  { value: 'amount:asc', label: 'Amount (low → high)', sort_by: 'amount', sort_order: 'asc' },
  { value: 'status:asc', label: 'Status (A → Z)', sort_by: 'status', sort_order: 'asc' },
  { value: 'status:desc', label: 'Status (Z → A)', sort_by: 'status', sort_order: 'desc' },
]

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 403) return 'You do not have access to these transactions.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading transactions.'
}

export function TransactionsTab({ loan }: { loan: LoanResponse }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  // Assigned employee (or admin) can edit/delete PENDING/FAILED rows so a
  // collector can correct their own misclick without admin intervention.
  // SUCCESS edits and deletes stay admin-only — the server gates this too.
  const perms = useFinancePermissions(loan)
  const canEditOpenTxn = isAdmin || perms.isAssignedEmployee
  // Mirrors the backend's PAYMENT_ACCEPTING_LOAN_STATUSES. BAD_DEBT_PROPOSED is
  // collectible — the proposal is pending admin review, not a settled write-off,
  // and paying it off is how a customer clears it. AWAITING_CLOSURE is NOT: it
  // means fully paid / admin finalising, so the server rejects a payment on it
  // and the Record button would only 400. Keep this list in step with the
  // backend set so we never surface a button the server refuses.
  const payable = loan.status === 'ACTIVE' || loan.status === 'BAD_DEBT_PROPOSED'

  const query = useLoanTransactions(loan.id)
  const summaryQuery = useLoanSummary(loan.id)
  // Cycles are joined client-side so the Cycle column resolves to the
  // cycle # + due date instead of a raw UUID. The query is shared with
  // DueCyclesTab so this is a cache hit when both render together.
  const cyclesQuery = useDueCycles(loan.id, loan.status !== 'DRAFT')
  const cyclesById = useMemo(() => {
    const map = new Map<string, DueCycleResponse>()
    for (const c of cyclesQuery.data?.results ?? []) map.set(c.id, c)
    return map
  }, [cyclesQuery.data])
  const confirm = useConfirmTransaction(loan.id)
  const fail = useFailTransaction(loan.id)
  const update = useUpdateTransaction(loan.id)
  const del = useDeleteTransaction(loan.id)
  const restore = useRestoreTransaction(loan.id)
  const [recordOpen, setRecordOpen] = useState(false)
  const [editTxn, setEditTxn] = useState<TransactionResponse | null>(null)

  // Client-side sort over the already-loaded transactions (one loan's worth).
  const [sort, setSort] = useState<SortState<TxnField>>({ sort_by: 'date', sort_order: 'desc' })
  const onSort = (field: TxnField, defaultDir: SortOrder) =>
    setSort((s) => toggleSort(s, field, defaultDir))
  const sortAccessors = useMemo<Partial<Record<TxnField, (t: TransactionResponse) => string | number | null>>>(
    () => ({
      date: (t) => t.effective_payment_date,
      amount: (t) => Number(t.amount),
      mode: (t) => PAYMENT_METHOD_LABELS[t.payment_mode],
      cycle: (t) => (t.due_cycle_id ? cyclesById.get(t.due_cycle_id)?.cycle_number ?? null : null),
      type: (t) => TXN_TYPE_LABELS[t.transaction_type],
      status: (t) => t.status,
    }),
    [cyclesById],
  )
  const sortedRows = useClientSort(query.data?.results ?? [], sort.sort_by, sort.sort_order, sortAccessors)

  // The transaction deleted in the last few seconds, kept in component state so
  // its row can hold its position and offer Restore. The list query drops it
  // the moment the delete lands, so the row has nowhere else to come from.
  // One at a time: deleting again closes the previous window, which is what its
  // timer was about to do anyway. Mirrors AllDocumentsSection's undo pattern.
  const [undo, setUndo] = useState<{ txn: TransactionResponse; index: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const closeUndo = () => {
    clearTimeout(undoTimer.current)
    setUndo(null)
  }

  // Cross-component focus: the cycle's "Pending confirmation" chip in
  // DueCyclesTab fires focusTransaction(txnId); we scroll the row into view
  // and pulse a highlight so the admin's eye lands on the Confirm button.
  // The highlight clears itself after a beat.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimer = useRef<number | null>(null)
  useTransactionFocus((txnId) => {
    setHighlightedId(txnId)
    // Defer until React commits — the targeted row needs to be in the DOM.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-txn-id="${txnId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 2500)
  })
  useEffect(
    () => () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    },
    [],
  )

  // Lazy-load the PDF module (jsPDF) only when a receipt is requested, so it
  // stays out of the loan-detail chunk.
  const onReceipt = async (txn: TransactionResponse) => {
    const { downloadReceiptPdf } = await import('../receiptPdf')
    downloadReceiptPdf({ txn, loan, summary: summaryQuery.data })
  }

  const openEdit = (txn: TransactionResponse) => {
    update.reset()
    setEditTxn(txn)
  }

  const onSaveEdit = (payload: import('@/api/queries/transactions').TransactionUpdate) => {
    if (!editTxn) return
    // No-op save: nothing actually changed. Close without a round trip.
    if (Object.keys(payload).length === 0) {
      setEditTxn(null)
      return
    }
    update.mutate(
      { transactionId: editTxn.id, payload },
      { onSuccess: () => setEditTxn(null) },
    )
  }

  // Soft-delete, then keep the row in place for the undo window. The index is
  // resolved against the current sort so Restore returns the row to where it
  // was rather than jumping it to the end of the list.
  const removeTxn = (txn: TransactionResponse) => {
    del.reset()
    const index = Math.max(0, sortedRows.findIndex((t) => t.id === txn.id))
    del.mutate(txn.id, {
      onSuccess: () => {
        clearTimeout(undoTimer.current)
        setUndo({ txn, index })
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
      },
    })
  }
  const onRestore = (txn: TransactionResponse) => {
    restore.reset()
    restore.mutate(txn.id, { onSuccess: closeUndo })
  }

  // Row-action errors that aren't shown inside a dialog (confirm/fail/delete/
  // restore) surface in the banner above the table; edit errors live in the
  // edit dialog.
  const actionError = confirm.isError
    ? mapActionError(confirm.error)
    : fail.isError
      ? mapActionError(fail.error)
      : del.isError
        ? mapActionError(del.error)
        : restore.isError
          ? mapActionError(restore.error)
          : null

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

  // Put the deleted row back where it was so Restore appears in place of the
  // Delete affordance. Filter by id first: between the DELETE resolving and the
  // list refetch, the deleted transaction is still in the cached page.
  const rows: TransactionResponse[] = sortedRows.filter((t) => t.id !== undo?.txn.id)
  if (undo) rows.splice(Math.min(undo.index, rows.length), 0, undo.txn)

  const acting =
    confirm.isPending || fail.isPending || update.isPending || del.isPending || restore.isPending
  // Action availability per row:
  //   - Confirm / Fail: admin only (server-gated).
  //   - Edit: in-scope user (admin OR assigned employee) on PENDING/FAILED;
  //     admin-only on SUCCESS.
  //   - Delete: same rule as Edit — in-scope on PENDING/FAILED, admin on
  //     SUCCESS. The server enforces all of these; we just decide what to show.
  const perRowGate = (txn: TransactionResponse) =>
    txn.status === 'SUCCESS' ? isAdmin : canEditOpenTxn
  const rowActions: RowActions | null =
    isAdmin || canEditOpenTxn
      ? {
          onConfirm: isAdmin ? (id: string) => confirm.mutate(id) : null,
          onFail: isAdmin ? (id: string) => fail.mutate(id) : null,
          onEdit: openEdit,
          onDelete: removeTxn,
          canEditTxn: perRowGate,
          canDeleteTxn: perRowGate,
          acting,
        }
      : null

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            Total collected
          </Typography>
          <Typography variant="h3">
            {fmtINR(Number(query.data?.total_collected ?? '0'))}
          </Typography>
        </Box>
        {payable && (
          <Btn variant="primary" size="sm" startIcon={<AddIcon />} onClick={() => setRecordOpen(true)}>
            Record payment
          </Btn>
        )}
      </Stack>

      {rows.length > 0 && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
          <SortSelect
            options={TXN_SORT_OPTIONS}
            sort_by={sort.sort_by}
            sort_order={sort.sort_order}
            onChange={setSort}
            sx={{ width: '100%' }}
          />
        </Box>
      )}

      {actionError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={actionError} severity="error" variant="outlined" />
        </Box>
      )}

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No payments recorded for this loan yet.
        </Typography>
      ) : (
        <>
          <DesktopTable
            rows={rows}
            actions={rowActions}
            onReceipt={onReceipt}
            cyclesById={cyclesById}
            highlightedId={highlightedId}
            undoTxnId={undo?.txn.id ?? null}
            onRestore={onRestore}
            restoring={restore.isPending}
            sort={sort}
            onSort={onSort}
          />
          <MobileCards
            rows={rows}
            actions={rowActions}
            onReceipt={onReceipt}
            cyclesById={cyclesById}
            highlightedId={highlightedId}
            undoTxnId={undo?.txn.id ?? null}
            onRestore={onRestore}
            restoring={restore.isPending}
          />
        </>
      )}

      <RecordPaymentDialog loanId={loan.id} open={recordOpen} onClose={() => setRecordOpen(false)} />

      <EditTransactionDialog
        txn={editTxn}
        loanId={loan.id}
        open={!!editTxn}
        onClose={() => setEditTxn(null)}
        onSubmit={onSaveEdit}
        saving={update.isPending}
        error={update.isError ? mapActionError(update.error) : null}
      />
    </>
  )
}

function mapActionError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (detail) return detail
    if (error.response?.status === 403) return 'You do not have permission for this action.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not update this transaction. Please try again.'
}

interface RowActions {
  // Admin-only inline buttons (Confirm/Fail). Null when the current user is an
  // assigned-employee with edit access but not an admin.
  onConfirm: ((id: string) => void) | null
  onFail: ((id: string) => void) | null
  // Edit / Delete are broader: admins for any row, in-scope users for
  // PENDING/FAILED. The per-row gates are canEditTxn / canDeleteTxn.
  onEdit: (txn: TransactionResponse) => void
  onDelete: (txn: TransactionResponse) => void
  canEditTxn: (txn: TransactionResponse) => boolean
  canDeleteTxn: (txn: TransactionResponse) => boolean
  acting: boolean
}

function TxnStatusChip({ status }: { status: TransactionStatus }) {
  const meta = TXN_STATUS_META[status]
  return <Chip size="small" label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}

function PendingActions({ id, actions }: { id: string; actions: RowActions }) {
  // Received (confirm) / Cancel (fail) are admin-only. Caller doesn't render
  // this component at all for non-admin users (see RowActionsCell), but we
  // guard defensively.
  if (!actions.onConfirm || !actions.onFail) return null
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'flex-end', '& .MuiButton-root': { whiteSpace: 'nowrap' } }}
    >
      <Btn variant="success" size="sm" onClick={() => actions.onConfirm!(id)} disabled={actions.acting}>
        Received
      </Btn>
      <Btn variant="danger" size="sm" onClick={() => actions.onFail!(id)} disabled={actions.acting}>
        Cancel
      </Btn>
    </Stack>
  )
}

// The in-place "are you sure?" that replaces a row's action buttons when Delete
// is chosen. No modal — the confirmation lives in the row itself, and the
// deleted row then offers Restore for a few seconds (the undo window).
function InlineDeleteConfirm({
  onCancel,
  onConfirm,
  acting,
}: {
  onCancel: () => void
  onConfirm: () => void
  acting: boolean
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        Delete this payment?
      </Typography>
      <Btn variant="ghost" size="sm" onClick={onCancel} disabled={acting}>
        Cancel
      </Btn>
      <Btn variant="danger" size="sm" onClick={onConfirm} disabled={acting}>
        Delete
      </Btn>
    </Stack>
  )
}

// Overflow menu for per-row actions that aren't the inline lifecycle buttons.
// Items appear conditionally based on row status + role:
//   - Edit transaction — any row the current user is allowed to edit
//   - Delete — any row the current user is allowed to delete (fires the inline
//     confirm rather than deleting immediately)
function RowKebab({
  txn,
  actions,
  onRequestDelete,
}: {
  txn: TransactionResponse
  actions: RowActions
  onRequestDelete: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)

  const showEdit = actions.canEditTxn(txn)
  const showDelete = actions.canDeleteTxn(txn)

  if (!showEdit && !showDelete) return null

  return (
    <>
      <IconButton
        size="small"
        aria-label="More actions"
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={actions.acting}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        {showEdit && (
          <MenuItem
            onClick={() => {
              close()
              actions.onEdit(txn)
            }}
          >
            <ListItemIcon>
              <EditNoteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit transaction</ListItemText>
          </MenuItem>
        )}
        {showDelete && (
          <MenuItem
            onClick={() => {
              close()
              onRequestDelete()
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Delete transaction</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

// Per-row actions:
//   - SUCCESS: Receipt download for everyone. In-scope admins get the kebab
//     (Edit / Delete).
//   - PENDING: Admin sees Received/Cancel (confirm/fail) inline; in-scope user
//     (admin or assigned employee) sees the kebab (Edit / Delete).
//   - FAILED: kebab (Edit / Delete) for in-scope users.
// Choosing Delete flips the whole cell to an inline "are you sure?" prompt.
function RowActionsCell({
  txn,
  actions,
  onReceipt,
}: {
  txn: TransactionResponse
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const receiptBtn =
    txn.status === 'SUCCESS' ? (
      <Btn variant="ghost" size="sm" startIcon={<ReceiptIcon />} onClick={() => onReceipt(txn)}>
        Receipt
      </Btn>
    ) : null

  if (!actions) return receiptBtn

  // The inline confirm owns the whole cell so the intent is unmistakable.
  if (confirmingDelete) {
    return (
      <InlineDeleteConfirm
        acting={actions.acting}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false)
          actions.onDelete(txn)
        }}
      />
    )
  }

  const kebab = (
    <RowKebab txn={txn} actions={actions} onRequestDelete={() => setConfirmingDelete(true)} />
  )

  if (txn.status === 'SUCCESS') {
    return (
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {receiptBtn}
        {kebab}
      </Stack>
    )
  }

  if (txn.status === 'PENDING') {
    // Admin gets Confirm/Fail inline; everyone with edit access gets the kebab.
    return (
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {actions.onConfirm && <PendingActions id={txn.id} actions={actions} />}
        {kebab}
      </Stack>
    )
  }

  if (txn.status === 'FAILED') {
    return <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{kebab}</Box>
  }
  return null
}

// Renders the cycle this txn was allocated to as "#N · 15 Jun" — or an em-dash
// when the txn is unallocated (DOWN_PAYMENT rows, or a paid-in-advance with no
// cycle pre-selected). The schedule-tab cycle number is the same N so the user
// can scan from txn to schedule by eye.
function CycleCell({
  txn,
  cyclesById,
}: {
  txn: TransactionResponse
  cyclesById: Map<string, DueCycleResponse>
}) {
  const cycle = txn.due_cycle_id ? cyclesById.get(txn.due_cycle_id) ?? null : null
  if (!cycle) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        —
      </Typography>
    )
  }
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
      <Box component="span" sx={{ fontWeight: 600 }}>
        #{cycle.cycle_number}
      </Box>
      <Typography component="span" variant="caption" color="text.secondary">
        {fmtDate(cycle.due_date)}
      </Typography>
    </Box>
  )
}

function DesktopTable({
  rows,
  actions,
  onReceipt,
  cyclesById,
  highlightedId,
  undoTxnId,
  onRestore,
  restoring,
  sort,
  onSort,
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
  cyclesById: Map<string, DueCycleResponse>
  highlightedId: string | null
  undoTxnId: string | null
  onRestore: (txn: TransactionResponse) => void
  restoring: boolean
  sort: SortState<TxnField>
  onSort: (field: TxnField, defaultDir: SortOrder) => void
}) {
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <TableContainer>
        <Table
          size="small"
          sx={{
            '& .MuiTableCell-root': { whiteSpace: 'nowrap' },
            '& .MuiChip-root': { minWidth: 96, justifyContent: 'center' },
          }}
        >
          <TableHead>
            <TableRow>
              <SortableTh field="date" label="Date" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <SortableTh field="amount" label="Amount" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
              <SortableTh field="mode" label="Mode" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <SortableTh field="cycle" label="Cycle" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <SortableTh field="type" label="Type" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <SortableTh field="status" label="Status" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((t) => {
              if (t.id === undoTxnId) {
                return (
                  <TableRow key={t.id} data-txn-id={t.id}>
                    <TableCell colSpan={7} sx={{ bgcolor: 'var(--surface-alt)' }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Deleted — {fmtINR(Number(t.amount))} · {fmtDate(t.effective_payment_date)}
                        </Typography>
                        <Btn
                          variant="ghost"
                          size="sm"
                          startIcon={<UndoIcon />}
                          onClick={() => onRestore(t)}
                          loading={restoring}
                        >
                          Restore
                        </Btn>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              }
              const isHighlighted = t.id === highlightedId
              return (
                <TableRow
                  key={t.id}
                  data-txn-id={t.id}
                  sx={(theme) => ({
                    transition: 'background-color 600ms ease',
                    ...(isHighlighted && {
                      backgroundColor:
                        theme.palette.mode === 'dark'
                          ? 'rgba(33, 150, 243, 0.18)'
                          : 'rgba(33, 150, 243, 0.12)',
                    }),
                  })}
                >
                  <TableCell>{fmtDate(t.effective_payment_date)}</TableCell>
                  <TableCell align="right">{fmtINR(Number(t.amount))}</TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[t.payment_mode]}</TableCell>
                  <TableCell>
                    <CycleCell txn={t} cyclesById={cyclesById} />
                  </TableCell>
                  <TableCell>{TXN_TYPE_LABELS[t.transaction_type]}</TableCell>
                  <TableCell>
                    <TxnStatusChip status={t.status} />
                  </TableCell>
                  <TableCell align="right">
                    <RowActionsCell txn={t} actions={actions} onReceipt={onReceipt} />
                  </TableCell>
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
  onReceipt,
  cyclesById,
  highlightedId,
  undoTxnId,
  onRestore,
  restoring,
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
  cyclesById: Map<string, DueCycleResponse>
  highlightedId: string | null
  undoTxnId: string | null
  onRestore: (txn: TransactionResponse) => void
  restoring: boolean
}) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((t) => {
        if (t.id === undoTxnId) {
          return (
            <Box
              key={t.id}
              data-txn-id={t.id}
              sx={{
                p: 1.5,
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 'var(--radius-sm)',
                bgcolor: 'var(--surface-alt)',
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Deleted
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {fmtINR(Number(t.amount))} · {fmtDate(t.effective_payment_date)}
                  </Typography>
                </Box>
                <Btn
                  variant="ghost"
                  size="sm"
                  startIcon={<UndoIcon />}
                  onClick={() => onRestore(t)}
                  loading={restoring}
                  sx={{ flexShrink: 0 }}
                >
                  Restore
                </Btn>
              </Stack>
            </Box>
          )
        }
        const cycle = t.due_cycle_id ? cyclesById.get(t.due_cycle_id) ?? null : null
        const isHighlighted = t.id === highlightedId
        return (
          <Box
            key={t.id}
            data-txn-id={t.id}
            sx={(theme) => ({
              p: 1.5,
              border: '1px solid',
              borderColor: isHighlighted ? 'info.main' : 'divider',
              borderRadius: 'var(--radius-sm)',
              transition: 'background-color 600ms ease, border-color 600ms ease',
              ...(isHighlighted && {
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(33, 150, 243, 0.18)'
                    : 'rgba(33, 150, 243, 0.12)',
              }),
            })}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {fmtINR(Number(t.amount))}
              </Typography>
              <TxnStatusChip status={t.status} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {fmtDate(t.effective_payment_date)} · {PAYMENT_METHOD_LABELS[t.payment_mode]} ·{' '}
              {TXN_TYPE_LABELS[t.transaction_type]}
            </Typography>
            {cycle && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                Cycle #{cycle.cycle_number} · due {fmtDate(cycle.due_date)}
              </Typography>
            )}
            {(t.status === 'SUCCESS' ||
              ((t.status === 'PENDING' || t.status === 'FAILED') && actions)) && (
              <Box sx={{ mt: 1.5 }}>
                <RowActionsCell txn={t} actions={actions} onReceipt={onReceipt} />
              </Box>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}
