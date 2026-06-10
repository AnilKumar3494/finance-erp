import { useEffect, useMemo, useRef, useState } from 'react'
import { AxiosError } from 'axios'
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

import {
  useLoanTransactions,
  useLoanSummary,
  useConfirmTransaction,
  useFailTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  type TransactionResponse,
} from '@/api/queries/transactions'
import { useDueCycles, type DueCycleResponse } from '@/api/queries/dueCycles'
import type { LoanResponse } from '@/api/queries/loans'
import { useFinancePermissions } from '../financePermissions'
import { useTransactionFocus } from '../txnFocus'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, Spinner } from '@/components/primitives'
import type { TransactionStatus, TransactionType } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { EditTransactionDialog } from './EditTransactionDialog'
import { VoidTransactionDialog } from './VoidTransactionDialog'

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
  // Assigned employee (or admin) can edit PENDING/FAILED rows so a collector
  // can correct their own misclick without admin intervention. SUCCESS edits
  // stay admin-only — server gates this too.
  const perms = useFinancePermissions(loan)
  const canEditOpenTxn = isAdmin || perms.isAssignedEmployee
  const payable = loan.status === 'ACTIVE' || loan.status === 'AWAITING_CLOSURE'

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
  const [recordOpen, setRecordOpen] = useState(false)
  const [editTxn, setEditTxn] = useState<TransactionResponse | null>(null)
  const [voidTxn, setVoidTxn] = useState<TransactionResponse | null>(null)

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
  const openVoid = (txn: TransactionResponse) => {
    del.reset()
    setVoidTxn(txn)
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
  const onConfirmVoid = () => {
    if (!voidTxn) return
    del.mutate(voidTxn.id, { onSuccess: () => setVoidTxn(null) })
  }

  // Row-action errors that aren't shown inside a dialog (confirm/fail) surface
  // in the banner above the table; edit/void errors live in their dialogs.
  const actionError = confirm.isError
    ? mapActionError(confirm.error)
    : fail.isError
      ? mapActionError(fail.error)
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

  const rows = query.data?.results ?? []
  const acting =
    confirm.isPending || fail.isPending || update.isPending || del.isPending
  // Action availability per row:
  //   - Confirm / Fail / Void: admin only (server-gated).
  //   - Edit: in-scope user (admin OR assigned employee) on PENDING/FAILED;
  //     admin-only on SUCCESS. The server enforces both — we just decide
  //     whether to show the kebab.
  const rowActions: RowActions | null =
    isAdmin || canEditOpenTxn
      ? {
          onConfirm: isAdmin ? (id: string) => confirm.mutate(id) : null,
          onFail: isAdmin ? (id: string) => fail.mutate(id) : null,
          onEdit: openEdit,
          onVoid: isAdmin ? openVoid : null,
          canEditTxn: (txn: TransactionResponse) => {
            if (txn.status === 'SUCCESS') return isAdmin
            return canEditOpenTxn
          },
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
          />
          <MobileCards
            rows={rows}
            actions={rowActions}
            onReceipt={onReceipt}
            cyclesById={cyclesById}
            highlightedId={highlightedId}
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

      <VoidTransactionDialog
        txn={voidTxn}
        open={!!voidTxn}
        onClose={() => setVoidTxn(null)}
        onConfirm={onConfirmVoid}
        deleting={del.isPending}
        error={del.isError ? mapActionError(del.error) : null}
      />
    </>
  )
}

function mapActionError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (detail) return detail
    if (error.response?.status === 403) return 'You do not have permission for this action.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not update this transaction. Please try again.'
}

interface RowActions {
  // Admin-only inline buttons (Confirm/Fail/Void). Null when the current user
  // is an assigned-employee with edit access but not an admin.
  onConfirm: ((id: string) => void) | null
  onFail: ((id: string) => void) | null
  onVoid: ((txn: TransactionResponse) => void) | null
  // Edit is broader: admins for any row, in-scope users for PENDING/FAILED.
  // The caller per-row gate is `canEditTxn`.
  onEdit: (txn: TransactionResponse) => void
  canEditTxn: (txn: TransactionResponse) => boolean
  acting: boolean
}

function TxnStatusChip({ status }: { status: TransactionStatus }) {
  const meta = TXN_STATUS_META[status]
  return <Chip size="small" label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}

function PendingActions({ id, actions }: { id: string; actions: RowActions }) {
  // Confirm/Fail are admin-only. Caller doesn't render this component at all
  // for non-admin users (see RowActionsCell), but we guard defensively.
  if (!actions.onConfirm || !actions.onFail) return null
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'flex-end', '& .MuiButton-root': { whiteSpace: 'nowrap' } }}
    >
      <Btn variant="success" size="sm" onClick={() => actions.onConfirm!(id)} disabled={actions.acting}>
        Confirm
      </Btn>
      <Btn variant="ghost" size="sm" onClick={() => actions.onFail!(id)} disabled={actions.acting}>
        Fail
      </Btn>
    </Stack>
  )
}

// Overflow menu for per-row actions that aren't the inline lifecycle
// buttons. Items appear conditionally based on row status + role:
//   - Edit transaction — any row the current user is allowed to edit
//   - Void — FAILED rows, admin only
function RowKebab({ txn, actions }: { txn: TransactionResponse; actions: RowActions }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)

  const showEdit = actions.canEditTxn(txn)
  const showVoid = txn.status === 'FAILED' && !!actions.onVoid

  if (!showEdit && !showVoid) return null

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
        {showVoid && (
          <MenuItem
            onClick={() => {
              close()
              actions.onVoid!(txn)
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Void</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

// Per-row actions:
//   - SUCCESS: Receipt download for everyone. Admin can edit via kebab.
//   - PENDING: Admin sees Confirm/Fail inline; in-scope user (admin or
//     assigned employee) sees the kebab with Edit.
//   - FAILED: kebab with Edit (in-scope) and Void (admin).
function RowActionsCell({
  txn,
  actions,
  onReceipt,
}: {
  txn: TransactionResponse
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
}) {
  const receiptBtn =
    txn.status === 'SUCCESS' ? (
      <Btn variant="ghost" size="sm" startIcon={<ReceiptIcon />} onClick={() => onReceipt(txn)}>
        Receipt
      </Btn>
    ) : null

  if (!actions) return receiptBtn

  if (txn.status === 'SUCCESS') {
    // Receipt + (optional) edit kebab.
    return (
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {receiptBtn}
        <RowKebab txn={txn} actions={actions} />
      </Stack>
    )
  }

  if (txn.status === 'PENDING') {
    // Admin gets Confirm/Fail inline; everyone with edit access gets the kebab.
    return (
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {actions.onConfirm && <PendingActions id={txn.id} actions={actions} />}
        <RowKebab txn={txn} actions={actions} />
      </Stack>
    )
  }

  if (txn.status === 'FAILED') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <RowKebab txn={txn} actions={actions} />
      </Box>
    )
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
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
  cyclesById: Map<string, DueCycleResponse>
  highlightedId: string | null
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
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Amount
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Cycle</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((t) => {
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
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
  cyclesById: Map<string, DueCycleResponse>
  highlightedId: string | null
}) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((t) => {
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
