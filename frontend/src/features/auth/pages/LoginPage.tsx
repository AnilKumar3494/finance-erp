import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useLogin } from '@/api/queries/auth'
import { Btn, ErrorBanner, Input, PasswordReveal } from '@/components/primitives'
import { sanitizeRedirect } from '@/features/auth/redirect'

const LoginSchema = z.object({
  // .trim() runs before .min() — paste with stray spaces still validates and
  // submits clean. Password is intentionally NOT trimmed: some legitimate
  // passwords contain whitespace.
  username: z.string().trim().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
})
type LoginFormValues = z.infer<typeof LoginSchema>

function mapLoginError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 401) return 'Invalid username or password.'
    if (status === 423) {
      const detail = serverMessage(error)
      return detail ?? 'Account is temporarily locked. Try again later.'
    }
    if (status === 429) return 'Too many login attempts. Please wait a minute and try again.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection and try again.'
  }
  return 'Login failed. Please try again.'
}

interface LoginPageProps {
  redirectAfterLogin?: string
}

export function LoginPage({ redirectAfterLogin }: LoginPageProps = {}) {
  const navigate = useNavigate()
  const loginMutation = useLogin()
  const target = sanitizeRedirect(redirectAfterLogin)
  const [showPassword, setShowPassword] = useState(false)

  const submitError = loginMutation.isError ? mapLoginError(loginMutation.error) : null

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = (values: LoginFormValues) => {
    loginMutation.mutate(values, {
      onSuccess: () => navigate({ to: target }),
    })
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex' }}>
      <FormPanel>
        <Stack spacing={4} sx={{ width: '100%', maxWidth: 400 }}>
          <Box>
            <Typography variant="h3" sx={{ fontSize: 20, mb: 0.5 }}>
              Welcome!
            </Typography>
            <Typography
              variant="h1"
              sx={{ fontWeight: 700, fontSize: 28, mb: 1, letterSpacing: '-0.01em' }}
            >
              Sri Adithya Finance
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to your account
            </Typography>
          </Box>

          {submitError && <ErrorBanner message={submitError} />}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Stack spacing={2.5}>
              <Input
                id="username"
                label="Username or email"
                required
                autoComplete="username"
                autoFocus
                placeholder="e.g. yourname or email"
                {...register('username')}
                error={errors.username?.message}
              />
              <Input
                id="password"
                label="Password"
                required
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
                error={errors.password?.message}
                slotProps={{
                  input: {
                    endAdornment: (
                      <PasswordReveal
                        shown={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                    ),
                  },
                }}
              />
              <Btn
                type="submit"
                variant="primary"
                size="md"
                loading={loginMutation.isPending}
                sx={{ mt: 1, py: 1.25 }}
                fullWidth
              >
                Sign in
              </Btn>
            </Stack>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            Accounts are provisioned by administrators. Contact your admin for access.
          </Typography>
        </Stack>
      </FormPanel>
    </Box>
  )
}

// --------------------------------------------------
// Left panel — brand block. Hidden on mobile.
// --------------------------------------------------

// --------------------------------------------------
// Right panel — form area. Full width on mobile.
// --------------------------------------------------

function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 3, md: 6 },
        bgcolor: 'background.default',
      }}
    >
      {children}
    </Box>
  )
}
