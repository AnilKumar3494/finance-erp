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
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined'

import { useChangePassword } from '@/api/queries/auth'
import { Btn, ErrorBanner, Input } from '@/components/primitives'

// Mirrors backend PasswordChangeRequest + _check_password_strength. The new
// password must differ from the current one and from the confirmation must
// match — both checked here so the user gets feedback before the round-trip.
const Schema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password'),
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(64, 'Password must be 64 characters or fewer')
      .refine((v) => /[A-Z]/.test(v), 'Must contain an uppercase letter')
      .refine((v) => /[0-9]/.test(v), 'Must contain a number'),
    confirm_password: z.string().min(1, 'Re-enter your new password'),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })
  .refine((v) => v.new_password !== v.current_password, {
    message: 'New password must be different from your current one',
    path: ['new_password'],
  })

type FormValues = z.infer<typeof Schema>

// 400 (wrong current password) is surfaced inline on the field, so this maps
// only the banner-worthy failures.
function mapChangeError(error: unknown): string | null {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 400) return null
    if (status === 422) return detail ?? 'Please check the highlighted fields.'
    if (status === 429) return 'Too many attempts. Please wait a moment.'
    if (status === 401) return 'Your session has expired. Please log in again.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong updating your password.'
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const changePassword = useChangePassword()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [done, setDone] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  })

  const pending = changePassword.isPending
  const bannerError = changePassword.isError ? mapChangeError(changePassword.error) : null

  const close = () => {
    if (pending) return
    reset()
    setShowCurrent(false)
    setShowNew(false)
    setDone(false)
    changePassword.reset()
    onClose()
  }

  const onSubmit = (v: FormValues) => {
    changePassword.mutate(
      { current_password: v.current_password, new_password: v.new_password },
      {
        onSuccess: () => setDone(true),
        onError: (err) => {
          // The only password-specific server rejection: wrong current password.
          if (err instanceof AxiosError && err.response?.status === 400) {
            setError('current_password', { message: 'Current password is incorrect.' })
          }
        },
      },
    )
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      {done ? (
        <SuccessPanel onDone={close} />
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogTitle sx={{ fontSize: 18 }}>Change password</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              {bannerError && <ErrorBanner message={bannerError} />}
              <Input
                id="cp_current"
                label="Current password"
                required
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                {...register('current_password')}
                error={errors.current_password?.message}
                slotProps={{
                  input: {
                    endAdornment: (
                      <RevealToggle shown={showCurrent} onToggle={() => setShowCurrent((v) => !v)} />
                    ),
                  },
                }}
              />
              <Input
                id="cp_new"
                label="New password"
                required
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                hint="At least 8 characters, with an uppercase letter and a number."
                {...register('new_password')}
                error={errors.new_password?.message}
                slotProps={{
                  input: {
                    endAdornment: (
                      <RevealToggle shown={showNew} onToggle={() => setShowNew((v) => !v)} />
                    ),
                  },
                }}
              />
              <Input
                id="cp_confirm"
                label="Confirm new password"
                required
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('confirm_password')}
                error={errors.confirm_password?.message}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Btn type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" loading={pending}>
              Update password
            </Btn>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  )
}

function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <InputAdornment position="end">
      <IconButton
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={onToggle}
        edge="end"
        size="small"
      >
        {shown ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
      </IconButton>
    </InputAdornment>
  )
}

function SuccessPanel({ onDone }: { onDone: () => void }) {
  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18 }}>
        <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
        Password updated
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Your password has been changed. Use the new password the next time you log in.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Btn variant="primary" onClick={onDone}>
          Done
        </Btn>
      </DialogActions>
    </>
  )
}
