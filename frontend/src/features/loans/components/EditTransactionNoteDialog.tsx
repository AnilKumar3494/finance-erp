import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { TransactionResponse } from '@/api/queries/transactions'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'

// Edit a transaction's free-text note. The backend accepts `notes` only and
// rejects edits on a confirmed (SUCCESS) transaction, so callers gate this to
// PENDING / FAILED rows. Submitting an empty note clears it (sends null).
export function EditNoteDialog({
  txn,
  open,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  txn: TransactionResponse | null
  open: boolean
  onClose: () => void
  onSubmit: (notes: string | null) => void
  saving: boolean
  error: string | null
}) {
  const [notes, setNotes] = useState('')

  // Re-seed from the transaction each time the dialog opens.
  useEffect(() => {
    if (open) setNotes(txn?.notes ?? '')
  }, [open, txn])

  const close = () => {
    if (saving) return
    onClose()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = notes.trim()
    onSubmit(trimmed ? trimmed : null)
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Edit note</DialogTitle>
      <Box component="form" id="edit-note-form" onSubmit={submit} noValidate>
        <DialogContent sx={{ pt: 0 }}>
          <Stack spacing={2}>
            {txn && (
              <Typography variant="body2" color="text.secondary">
                {fmtINR(Number(txn.amount))} · {fmtDate(txn.effective_payment_date)}
              </Typography>
            )}
            {error && <ErrorBanner message={error} />}
            <Input
              id="edit-note-text"
              label="Note"
              placeholder="Optional — leave blank to clear"
              autoFocus
              multiline
              minRows={3}
              maxRows={8}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
          <Btn variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Btn>
          <Btn type="submit" form="edit-note-form" variant="primary" loading={saving}>
            Save note
          </Btn>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
