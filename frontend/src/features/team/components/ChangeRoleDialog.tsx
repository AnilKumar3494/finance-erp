import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useChangeUserRole, type UserAccount } from '@/api/queries/users'
import { Btn, ErrorBanner } from '@/components/primitives'
import type { UserRole } from '@/schemas/enums'
import { USER_ROLE_META } from '../userRoleMeta'

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 403) return detail ?? 'You do not have permission to change this role.'
    if (status === 404) return 'Account not found.'
    if (status === 400) return detail ?? 'That role change is not allowed.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong changing the role.'
}

// Super-Admin-only EMPLOYEE <-> ADMIN toggle. The caller only renders this for
// EMPLOYEE/ADMIN targets that aren't the current user.
export function ChangeRoleDialog({
  user,
  open,
  onClose,
}: {
  user: UserAccount
  open: boolean
  onClose: () => void
}) {
  const changeRole = useChangeUserRole()
  const nextRole: UserRole = user.role === 'ADMIN' ? 'EMPLOYEE' : 'ADMIN'
  const display = user.full_name?.trim() || user.username

  const close = () => {
    if (changeRole.isPending) return
    changeRole.reset()
    onClose()
  }

  const onConfirm = () =>
    changeRole.mutate({ userId: user.id, role: nextRole }, { onSuccess: close })

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 18 }}>Change role</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Change{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              {display}
            </Box>{' '}
            from {USER_ROLE_META[user.role].label} to{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              {USER_ROLE_META[nextRole].label}
            </Box>
            ?
          </Typography>
          {changeRole.isError && <ErrorBanner message={mapError(changeRole.error)} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Btn variant="ghost" onClick={close} disabled={changeRole.isPending}>
          Cancel
        </Btn>
        <Btn variant="primary" onClick={onConfirm} loading={changeRole.isPending}>
          Change to {USER_ROLE_META[nextRole].label}
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
