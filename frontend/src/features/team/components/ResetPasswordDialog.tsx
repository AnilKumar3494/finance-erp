import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined'
import AutorenewIcon from '@mui/icons-material/AutorenewOutlined'

import { useResetUserPassword, type UserAccount } from '@/api/queries/users'
import { Btn, ErrorBanner, FieldLabel, Input, PasswordReveal } from '@/components/primitives'
import { generatePassword } from '../generatePassword'
import { CopyField } from './CopyField'

const Schema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(64, 'Password must be 64 characters or fewer')
    .refine((v) => /[A-Z]/.test(v), 'Must contain an uppercase letter')
    .refine((v) => /[0-9]/.test(v), 'Must contain a number'),
})

type FormValues = z.infer<typeof Schema>

function mapResetError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 403) return detail ?? 'You do not have permission to reset this account.'
    if (status === 404) return 'Account not found — it may have been removed.'
    if (status === 422) return detail ?? 'Please check the highlighted fields.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong resetting the password.'
}

// Admin/super-admin sets a new temporary password for an existing user. The
// caller chooses the value (Generate helper), it's sent to the backend, then
// revealed once to copy & share — mirrors CreateAccountDialog's flow.
export function ResetPasswordDialog({
  user,
  open,
  onClose,
}: {
  user: UserAccount
  open: boolean
  onClose: () => void
}) {
  const resetPassword = useResetUserPassword()
  const [showPassword, setShowPassword] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { password: '' },
  })

  const pending = resetPassword.isPending
  const display = user.full_name?.trim() || user.username

  const close = () => {
    if (pending) return
    reset()
    setShowPassword(false)
    setIssued(null)
    resetPassword.reset()
    onClose()
  }

  const onSubmit = (v: FormValues) => {
    resetPassword.mutate(
      { userId: user.id, newPassword: v.password },
      { onSuccess: () => setIssued(v.password) },
    )
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      {issued ? (
        <IssuedPanel display={display} username={user.username} password={issued} onDone={close} />
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogTitle sx={{ fontSize: 18 }}>Reset Password</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Set a new temporary password for{' '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                  {display}
                </Box>{' '}
                ({user.username}). Share it with them; they can change it after signing in.
              </Typography>
              {resetPassword.isError && <ErrorBanner message={mapResetError(resetPassword.error)} />}
              <Box>
                <FieldLabel htmlFor="reset_password" required>
                  New temporary password
                </FieldLabel>
                <Input
                  id="reset_password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  hint="At least 8 characters, with an uppercase letter and a number."
                  {...register('password')}
                  error={errors.password?.message}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <PasswordReveal
                          shown={showPassword}
                          onToggle={() => setShowPassword((s) => !s)}
                        />
                      ),
                    },
                  }}
                />
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  startIcon={<AutorenewIcon />}
                  onClick={() => {
                    setValue('password', generatePassword(), { shouldValidate: true })
                    setShowPassword(true)
                  }}
                  sx={{ mt: 1 }}
                >
                  Generate password
                </Btn>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Btn type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" loading={pending}>
              Reset password
            </Btn>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  )
}

// One-time reveal: the new credential the admin must share. Never retrievable
// again, so it's surfaced clearly with copy buttons.
function IssuedPanel({
  display,
  username,
  password,
  onDone,
}: {
  display: string
  username: string
  password: string
  onDone: () => void
}) {
  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18 }}>
        <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
        Password reset
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Share this temporary password with {display} securely. It won&apos;t be shown again —
            ask them to change it after signing in.
          </Typography>
          <CopyField label="Username" value={username} />
          <CopyField label="Temporary password" value={password} mono />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Btn variant="primary" onClick={onDone}>
          Done
        </Btn>
      </DialogActions>
    </>
  )
}
