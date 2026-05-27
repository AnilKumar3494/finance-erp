import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useLogin } from '@/api/queries/auth'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
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
      const detail = (error.response?.data as { detail?: string } | undefined)?.detail
      return detail ?? 'Account is temporarily locked. Try again later.'
    }
    if (status === 429)
      return 'Too many login attempts. Please wait a minute and try again.'
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
      <BrandPanel />
      <FormPanel>
        <Stack spacing={4} sx={{ width: '100%', maxWidth: 400 }}>
          <Box>
            <Typography
              variant="overline"
              sx={{
                display: { xs: 'block', md: 'none' },
                color: 'primary.main',
                mb: 1,
              }}
            >
              FinERP
            </Typography>
            <Typography variant="h2" sx={{ fontSize: 24, mb: 0.5 }}>
              Welcome back
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to your FinERP account
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
                placeholder="e.g. yourname or you@finerp.in"
                {...register('username')}
                error={errors.username?.message}
              />
              <Input
                id="password"
                label="Password"
                required
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
                error={errors.password?.message}
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

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center' }}
          >
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

function BrandPanel() {
  return (
    <Box
      sx={{
        flex: 1,
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        justifyContent: 'space-between',
        p: 6,
        color: 'common.white',
        background: (theme) =>
          `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle decorative blur — adds depth without an image asset */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: -120,
          right: -120,
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          filter: 'blur(40px)',
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          bottom: -80,
          left: -80,
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)',
          filter: 'blur(40px)',
        }}
      />

      <Box sx={{ position: 'relative' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em' }}>
          FinERP
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
          Vehicle Finance · NBFC Suite
        </Typography>
      </Box>

      <Stack spacing={2} sx={{ position: 'relative' }}>
        <Typography
          sx={{ fontSize: 36, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}
        >
          Powering disciplined loan operations.
        </Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, lineHeight: 1.6 }}>
          End-to-end customer, vehicle, and ledger management — built for Indian
          NBFCs and rigorously audited at every step.
        </Typography>
      </Stack>

      <Stack spacing={1.5} sx={{ position: 'relative' }}>
        <FeatureBullet>Customer KYC, identity & stability verification</FeatureBullet>
        <FeatureBullet>Loan lifecycle, EMI tracking & closure workflows</FeatureBullet>
        <FeatureBullet>Tamper-evident audit log on every change</FeatureBullet>
      </Stack>
    </Box>
  )
}

function FeatureBullet({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <CheckCircleOutlineIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} />
      <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
        {children}
      </Typography>
    </Stack>
  )
}

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
