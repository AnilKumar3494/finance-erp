import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { TransactionResponse } from '@/api/queries/transactions'
import { Btn, ErrorBanner } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'

// Void (soft-delete) a FAILED transaction. The backend allows deletion only
// for FAILED rows; a wrong PENDING/SUCCESS payment must be failed first. This
// is a terminal action, so it asks for explicit confirmation.
export function VoidTransactionDialog({
  txn,
  open,
  onClose,
  onConfirm,
  deleting,
  error,
}: {
  txn: TransactionResponse | null
  open: boolean
  onClose: () => void
  onConfirm: () => void
  deleting: boolean
  error: string | null
}) {
  const close = () => {
    if (deleting) return
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Void this transaction?</DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          {error && <ErrorBanner message={error} />}
          <Typography variant="body2" color="text.secondary">
            This permanently removes the failed payment from the ledger. It
            cannot be undone.
          </Typography>
          {txn && (
            <Box
              sx={{
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {fmtINR(Number(txn.amount))}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {fmtDate(txn.effective_payment_date)} ·{' '}
                {PAYMENT_METHOD_LABELS[txn.payment_mode]}
              </Typography>
            </Box>
          )}
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
        <Btn variant="ghost" onClick={close} disabled={deleting}>
          Cancel
        </Btn>
        <Btn variant="danger" onClick={onConfirm} loading={deleting}>
          Void transaction
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
