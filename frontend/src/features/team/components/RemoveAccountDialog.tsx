import { useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import { useDeleteAdmin, useDeleteEmployee, type UserAccount } from '@/api/queries/users'
import { Btn, ErrorBanner, FieldLabel, Input } from '@/components/primitives'

const CONFIRM_WORD = 'delete'

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 403) return detail ?? 'You do not have permission to remove this account.'
    if (status === 404) return 'Account not found — it may already be removed.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong removing this account.'
}

// Removes an account. The endpoint is chosen by the target's role: ADMIN rows
// go through the super-admin-only /auth/admin route; everyone else through
// /auth/employee. (The caller only renders this for permitted targets.)
export function RemoveAccountDialog({
  user,
  open,
  onClose,
}: {
  user: UserAccount
  open: boolean
  onClose: () => void
}) {
  const delEmployee = useDeleteEmployee()
  const delAdmin = useDeleteAdmin()
  const [confirm, setConfirm] = useState('')

  const del = user.role === 'ADMIN' ? delAdmin : delEmployee
  const canDelete = confirm.trim().toLowerCase() === CONFIRM_WORD

  const close = () => {
    if (del.isPending) return
    setConfirm('')
    delEmployee.reset()
    delAdmin.reset()
    onClose()
  }

  const onConfirm = () => {
    if (!canDelete) return
    del.mutate(user.id, { onSuccess: close })
  }

  const display = user.full_name?.trim() || user.username

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontSize: 18 }}>
        <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
        Remove this account?
      </DialogTitle>
      <DialogContent sx={{ pb: 1.5 }}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            This deactivates and removes{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              {display}
            </Box>{' '}
            ({user.username}). They will no longer be able to sign in.
          </Typography>
          <Box>
            <FieldLabel htmlFor="remove_confirm">
              Type <Box component="span" sx={{ fontWeight: 700 }}>delete</Box> to confirm
            </FieldLabel>
            <Input
              id="remove_confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="delete"
              autoComplete="off"
              autoFocus
            />
          </Box>
          {del.isError && <ErrorBanner message={mapError(del.error)} />}
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
          Remove account
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
