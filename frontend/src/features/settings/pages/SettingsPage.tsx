import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { serverMessage } from '@/api/errors'
import { useBranding, useUpdateBranding } from '@/api/queries/settings'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input } from '@/components/primitives'

// Mirrors backend BrandingUpdate: values are trimmed, display_name 1-100 and
// short_name 1-30 characters.
const Schema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, 'Enter a display name')
    .max(100, 'Display name must be 100 characters or fewer'),
  short_name: z
    .string()
    .trim()
    .min(1, 'Enter a short name')
    .max(30, 'Short name must be 30 characters or fewer'),
})

type FormValues = z.infer<typeof Schema>

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 403) return 'Only the super admin can change these settings.'
    if (status === 404) return 'The server does not support this setting yet.'
    if (status === 422) return serverMessage(error) ?? 'Please check the highlighted fields.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong saving the settings.'
}

export function SettingsPage() {
  const { user } = useAuth()

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <Box sx={{ maxWidth: 720, mx: 'auto' }}>
        <Typography variant="h2" sx={{ mb: 3 }}>
          Settings
        </Typography>
        <Card>
          <Typography variant="h3">Restricted</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Settings are available to the super admin only.
          </Typography>
        </Card>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        Settings
      </Typography>
      <OrganizationCard />
    </Box>
  )
}

function OrganizationCard() {
  const branding = useBranding()
  const update = useUpdateBranding()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    // Follows the loaded branding until the user starts editing.
    values: branding,
    resetOptions: { keepDirtyValues: true },
  })

  const error = update.isError ? mapError(update.error) : null

  const onSubmit = (v: FormValues) => update.mutate(v)

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Organization
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The name staff and customers see for this organization.
      </Typography>

      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      {update.isSuccess && !error && !isDirty && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="success" variant="outlined" message="Settings saved." />
        </Box>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2.5}>
          <Input
            id="settings_display_name"
            label="Display name"
            required
            hint="Shown on the login page, sidebar, receipts, statements and reports."
            {...register('display_name')}
            error={errors.display_name?.message}
          />
          <Input
            id="settings_short_name"
            label="Short name"
            required
            hint="Shown in the collapsed sidebar."
            {...register('short_name')}
            error={errors.short_name?.message}
          />
          <Box>
            <Btn type="submit" loading={update.isPending} disabled={!isDirty}>
              Save Changes
            </Btn>
          </Box>
        </Stack>
      </Box>
    </Card>
  )
}
