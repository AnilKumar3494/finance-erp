import { useState } from 'react'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import { useDeleteLoan, type LoanResponse } from '@/api/queries/loans'
import { loanDisplayId } from '@/features/loans/loanIdentity'
import { Btn, Card, ErrorBanner, FieldLabel, Input } from '@/components/primitives'

const CONFIRM_WORD = 'delete'

function mapDeleteError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 403) return detail ?? 'You do not have permission to delete this finance.'
    if (status === 404) return 'Finance not found — it may already be deleted.'
    if (status === 409) return detail ?? 'This finance can no longer be deleted.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong deleting this finance. Please try again.'
}

// Admin / Super-Admin only, DRAFT only (gated by the caller). Permanently
// removes a draft finance behind an AWS-style "type delete to confirm" gate.
export function DeleteDraftAction({ loan }: { loan: LoanResponse }) {
  const navigate = useNavigate()
  const del = useDeleteLoan(loan.id)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')

  const close = () => {
    if (del.isPending) return
    setOpen(false)
    setConfirm('')
  }

  const canDelete = confirm.trim().toLowerCase() === CONFIRM_WORD

  const onConfirm = () => {
    if (!canDelete) return
    del.mutate(undefined, {
      onSuccess: () => navigate({ to: '/finances', search: { page: 1 } }),
    })
  }

  const error = del.isError ? mapDeleteError(del.error) : null

  return (
    <Card sx={{ borderColor: 'var(--danger)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
        <Typography variant="h3">Delete draft</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Permanently delete this draft finance. This cannot be undone. Only drafts can be
        deleted — once approved, a finance must be closed instead.
      </Typography>
      <Btn variant="danger" onClick={() => setOpen(true)}>
        Delete draft
      </Btn>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle
          sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontSize: 18 }}
        >
          <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
          Delete this draft?
        </DialogTitle>
        <DialogContent sx={{ pb: 1.5 }}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              This permanently deletes draft{' '}
              <Box component="span" sx={{ fontFamily: 'var(--font-mono)', color: 'text.primary' }}>
                {loanDisplayId(loan)}
              </Box>
              {loan.customer?.full_name ? ` for ${loan.customer.full_name}` : ''}. This action
              cannot be undone.
            </Typography>
            <Box>
              <FieldLabel htmlFor="delete_confirm">
                Type <Box component="span" sx={{ fontWeight: 700 }}>delete</Box> to confirm
              </FieldLabel>
              <Input
                id="delete_confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="delete"
                autoComplete="off"
                autoFocus
              />
            </Box>
            {error && <ErrorBanner message={error} />}
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            pb: 2.5,
            pt: 0,
            gap: 1,
            flexDirection: { xs: 'column-reverse', sm: 'row' },
            '& > :not(:first-of-type)': { ml: 0 },
            '& > button': { width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' },
          }}
        >
          <Btn variant="ghost" onClick={close} disabled={del.isPending}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={onConfirm} disabled={!canDelete} loading={del.isPending}>
            Delete draft
          </Btn>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
