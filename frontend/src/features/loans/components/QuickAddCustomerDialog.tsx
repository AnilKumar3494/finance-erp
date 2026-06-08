import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  useCreateCustomer,
  type CustomerCreate,
  type CustomerResponse,
} from '@/api/queries/customers'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { MOBILE_RE } from '@/schemas/primitives'

// Minimal create — only the backend-required fields. The rest of the KYC
// (Aadhaar/PAN/address/DOB/…) is collected in the wizard's Customer & KYC step.
const Schema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must be 255 characters or fewer'),
  mobile_number: z
    .string()
    .regex(MOBILE_RE, 'Enter a 10-digit mobile number starting with 6, 7, 8, or 9'),
})
type FormValues = z.infer<typeof Schema>

function mapErr(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 409) return detail ?? 'A customer with this mobile already exists.'
    if (status === 422) return detail ?? 'Please check the details and try again.'
    if (status === 403) return detail ?? 'You do not have permission to create a customer.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong creating the customer. Please try again.'
}

export function QuickAddCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (customer: CustomerResponse) => void
}) {
  const create = useCreateCustomer()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { full_name: '', mobile_number: '' },
  })

  const close = () => {
    if (create.isPending) return
    create.reset()
    reset()
    onClose()
  }

  const onSubmit = (v: FormValues) => {
    const payload: CustomerCreate = {
      full_name: v.full_name.trim(),
      mobile_number: v.mobile_number,
    }
    create.mutate(payload, {
      onSuccess: (customer) => {
        reset()
        onCreated(customer)
      },
    })
  }

  const error = create.isError ? mapErr(create.error) : null

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>New customer</DialogTitle>
      <Box
        component="form"
        id="quick-add-customer-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <DialogContent sx={{ pt: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Quick add a new customer with their name and mobile number.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You can fill in the rest of the details in later steps.
          </Typography>
          <Stack spacing={2.5}>
            {error && <ErrorBanner message={error} />}
            <Input
              id="qac_full_name"
              label="Full name"
              required
              autoFocus
              autoComplete="off"
              {...register('full_name')}
              error={errors.full_name?.message}
            />
            <Input
              id="qac_mobile"
              label="Mobile number"
              required
              inputMode="numeric"
              placeholder="10 digits, starting 6/7/8/9"
              autoComplete="off"
              {...register('mobile_number')}
              error={errors.mobile_number?.message}
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
          <Btn variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            form="quick-add-customer-form"
            variant="primary"
            loading={create.isPending}
          >
            Create &amp; select
          </Btn>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
