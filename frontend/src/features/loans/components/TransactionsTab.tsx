import { useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import type { ChipProps } from '@mui/material/Chip'
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

import {
  useLoanTransactions,
  useLoanSummary,
  useConfirmTransaction,
  useFailTransaction,
  type TransactionResponse,
} from '@/api/queries/transactions'
import type { LoanResponse } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, Spinner } from '@/components/primitives'
import type { TransactionStatus, TransactionType } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'
import { RecordPaymentDialog } from './RecordPaymentDialog'

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
  const payable = loan.status === 'ACTIVE' || loan.status === 'AWAITING_CLOSURE'

  const query = useLoanTransactions(loan.id)
  const summaryQuery = useLoanSummary(loan.id)
  const confirm = useConfirmTransaction(loan.id)
  const fail = useFailTransaction(loan.id)
  const [recordOpen, setRecordOpen] = useState(false)

  // Lazy-load the PDF module (jsPDF) only when a receipt is requested, so it
  // stays out of the loan-detail chunk.
  const onReceipt = async (txn: TransactionResponse) => {
    const { downloadReceiptPdf } = await import('../receiptPdf')
    downloadReceiptPdf({ txn, loan, summary: summaryQuery.data })
  }

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
  const acting = confirm.isPending || fail.isPending
  const rowActions = isAdmin
    ? {
        onConfirm: (id: string) => confirm.mutate(id),
        onFail: (id: string) => fail.mutate(id),
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
          <DesktopTable rows={rows} actions={rowActions} onReceipt={onReceipt} />
          <MobileCards rows={rows} actions={rowActions} onReceipt={onReceipt} />
        </>
      )}

      <RecordPaymentDialog loanId={loan.id} open={recordOpen} onClose={() => setRecordOpen(false)} />
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
  onConfirm: (id: string) => void
  onFail: (id: string) => void
  acting: boolean
}

function TxnStatusChip({ status }: { status: TransactionStatus }) {
  const meta = TXN_STATUS_META[status]
  return <Chip size="small" label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}

function PendingActions({ id, actions }: { id: string; actions: RowActions }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: 'flex-end', '& .MuiButton-root': { whiteSpace: 'nowrap' } }}
    >
      <Btn variant="success" size="sm" onClick={() => actions.onConfirm(id)} disabled={actions.acting}>
        Confirm
      </Btn>
      <Btn variant="ghost" size="sm" onClick={() => actions.onFail(id)} disabled={actions.acting}>
        Fail
      </Btn>
    </Stack>
  )
}

// Per-row actions: admins confirm/fail a PENDING txn; anyone can download a
// receipt for a confirmed (SUCCESS) one.
function RowActionsCell({
  txn,
  actions,
  onReceipt,
}: {
  txn: TransactionResponse
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
}) {
  if (txn.status === 'PENDING' && actions) return <PendingActions id={txn.id} actions={actions} />
  if (txn.status === 'SUCCESS') {
    return (
      <Btn variant="ghost" size="sm" startIcon={<ReceiptIcon />} onClick={() => onReceipt(txn)}>
        Receipt
      </Btn>
    )
  }
  return null
}

function DesktopTable({
  rows,
  actions,
  onReceipt,
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
}) {
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <TableContainer>
        <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Amount
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.effective_payment_date)}</TableCell>
                <TableCell align="right">{fmtINR(Number(t.amount))}</TableCell>
                <TableCell>{PAYMENT_METHOD_LABELS[t.payment_mode]}</TableCell>
                <TableCell>{TXN_TYPE_LABELS[t.transaction_type]}</TableCell>
                <TableCell>
                  <TxnStatusChip status={t.status} />
                </TableCell>
                <TableCell align="right">
                  <RowActionsCell txn={t} actions={actions} onReceipt={onReceipt} />
                </TableCell>
              </TableRow>
            ))}
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
}: {
  rows: TransactionResponse[]
  actions: RowActions | null
  onReceipt: (txn: TransactionResponse) => void
}) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((t) => (
        <Box
          key={t.id}
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
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {fmtINR(Number(t.amount))}
            </Typography>
            <TxnStatusChip status={t.status} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {fmtDate(t.effective_payment_date)} · {PAYMENT_METHOD_LABELS[t.payment_mode]} ·{' '}
            {TXN_TYPE_LABELS[t.transaction_type]}
          </Typography>
          {(t.status === 'SUCCESS' || (t.status === 'PENDING' && actions)) && (
            <Box sx={{ mt: 1.5 }}>
              <RowActionsCell txn={t} actions={actions} onReceipt={onReceipt} />
            </Box>
          )}
        </Box>
      ))}
    </Stack>
  )
}
