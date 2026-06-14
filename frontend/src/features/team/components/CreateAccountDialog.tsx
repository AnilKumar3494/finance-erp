import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined'
import AutorenewIcon from '@mui/icons-material/AutorenewOutlined'

import {
  useCreateAdmin,
  useCreateEmployee,
  type AccountCreate,
  type UserAccount,
} from '@/api/queries/users'
import { Btn, ErrorBanner, FieldLabel, Input } from '@/components/primitives'
import type { UserRole } from '@/schemas/enums'
import { USER_ROLE_META } from '../userRoleMeta'
import { generatePassword } from '../generatePassword'

// Roles an admin can provision. SUPER_ADMIN is never creatable via the API.
const CREATABLE_ROLES = ['EMPLOYEE', 'ADMIN'] as const

const Schema = z.object({
  role: z.enum(CREATABLE_ROLES),
  full_name: z.string().trim().max(100, 'Name must be 100 characters or fewer'),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or fewer'),
  email: z.string().trim().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(64, 'Password must be 64 characters or fewer')
    .refine((v) => /[A-Z]/.test(v), 'Must contain an uppercase letter')
    .refine((v) => /[0-9]/.test(v), 'Must contain a number'),
})

type FormValues = z.infer<typeof Schema>

function mapCreateError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 409) return detail ?? 'Username or email is already taken.'
    if (status === 422) return detail ?? 'Please check the highlighted fields.'
    if (status === 403) return detail ?? 'You do not have permission to create this account.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong creating the account.'
}

interface CreatedCreds {
  username: string
  password: string
  role: UserRole
}

export function CreateAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createEmployee = useCreateEmployee()
  const createAdmin = useCreateAdmin()
  const [showPassword, setShowPassword] = useState(false)
  const [created, setCreated] = useState<CreatedCreds | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { role: 'EMPLOYEE', full_name: '', username: '', email: '', password: '' },
  })

  const pending = createEmployee.isPending || createAdmin.isPending
  const mutationError = createEmployee.isError
    ? mapCreateError(createEmployee.error)
    : createAdmin.isError
      ? mapCreateError(createAdmin.error)
      : null

  const close = () => {
    if (pending) return
    reset()
    setShowPassword(false)
    setCreated(null)
    createEmployee.reset()
    createAdmin.reset()
    onClose()
  }

  const onSubmit = (v: FormValues) => {
    const payload: AccountCreate = {
      username: v.username.trim(),
      email: v.email.trim(),
      full_name: v.full_name.trim() === '' ? undefined : v.full_name.trim(),
      password: v.password,
    }
    const onSuccess = (_acct: UserAccount) =>
      setCreated({ username: payload.username, password: payload.password, role: v.role })
    if (v.role === 'ADMIN') createAdmin.mutate(payload, { onSuccess })
    else createEmployee.mutate(payload, { onSuccess })
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      {created ? (
        <CreatedPanel creds={created} onDone={close} />
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogTitle sx={{ fontSize: 18 }}>Add account</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              {mutationError && <ErrorBanner message={mutationError} />}
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Input
                    id="acct_role"
                    label="Role"
                    select
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={errors.role?.message}
                  >
                    {CREATABLE_ROLES.map((r) => (
                      <MenuItem key={r} value={r}>
                        {USER_ROLE_META[r].label}
                      </MenuItem>
                    ))}
                  </Input>
                )}
              />
              <Input
                id="acct_full_name"
                label="Full name"
                placeholder="Optional"
                autoComplete="off"
                {...register('full_name')}
                error={errors.full_name?.message}
              />
              <Input
                id="acct_username"
                label="Username"
                required
                autoComplete="off"
                {...register('username')}
                error={errors.username?.message}
              />
              <Input
                id="acct_email"
                label="Email"
                required
                autoComplete="off"
                {...register('email')}
                error={errors.email?.message}
              />
              <Box>
                <FieldLabel htmlFor="acct_password" required>
                  Temporary password
                </FieldLabel>
                <Input
                  id="acct_password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  hint="At least 8 characters, with an uppercase letter and a number."
                  {...register('password')}
                  error={errors.password?.message}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            size="small"
                          >
                            {showPassword ? (
                              <VisibilityOffIcon fontSize="small" />
                            ) : (
                              <VisibilityIcon fontSize="small" />
                            )}
                          </IconButton>
                        </InputAdornment>
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
              Create account
            </Btn>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  )
}

// One-time confirmation: shows the credentials the admin must share. The
// password is never retrievable again, so we surface it clearly with copy.
function CreatedPanel({ creds, onDone }: { creds: CreatedCreds; onDone: () => void }) {
  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18 }}>
        <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
        Account created
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Share these credentials securely with the new {USER_ROLE_META[creds.role].label.toLowerCase()}.
            The password won&apos;t be shown again — ask them to change it after their first login.
          </Typography>
          <CopyField label="Username" value={creds.username} />
          <CopyField label="Temporary password" value={creds.password} mono />
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

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <Box>
      <FieldLabel>{label}</FieldLabel>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.25,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}
        >
          {value}
        </Typography>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={copied ? <CheckCircleIcon /> : <ContentCopyIcon />}
          onClick={copy}
          sx={{ flexShrink: 0 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Btn>
      </Stack>
    </Box>
  )
}
