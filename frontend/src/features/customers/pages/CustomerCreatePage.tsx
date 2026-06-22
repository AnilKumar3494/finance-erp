import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs, { type Dayjs } from 'dayjs'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import {
  useCreateCustomer,
  type CustomerCreate,
} from '@/api/queries/customers'
import type { EmployeeResponse } from '@/api/queries/employees'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, FieldLabel, Input } from '@/components/primitives'
import { EmployeePicker } from '@/features/customers/components/EmployeePicker'
import {
  AADHAAR_RE,
  MOBILE_RE,
  PAN_RE,
  PIN_RE,
} from '@/schemas/primitives'

// --------------------------------------------------
// Validation — mirrors backend/app/schemas/customer.py exactly. Optional
// fields accept empty string (the natural HTML input default) but reject
// non-empty values that don't match the format. Empty strings get stripped
// to undefined right before the API call so the backend sees the same
// shape as Pydantic Optional.
// --------------------------------------------------

const optionalFormat = (re: RegExp, msg: string) =>
  z.string().refine((v) => v === '' || re.test(v), msg)

const Schema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must be 255 characters or fewer'),
  mobile_number: z
    .string()
    .regex(MOBILE_RE, 'Enter a 10-digit mobile number starting with 6, 7, 8, or 9'),
  alt_mobile_number: optionalFormat(
    MOBILE_RE,
    'Enter a 10-digit mobile number starting with 6, 7, 8, or 9',
  ),
  aadhaar_number: optionalFormat(AADHAAR_RE, 'Aadhaar must be exactly 12 digits'),
  pan_number: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || PAN_RE.test(v), {
      message: 'PAN must be in the format AAAAA9999A',
    }),
  date_of_birth: z
    .custom<Dayjs | null>((v) => v === null || dayjs.isDayjs(v), 'Invalid date')
    .nullable()
    .refine(
      (v) => v === null || (v.isValid() && v.isBefore(dayjs().add(1, 'day'))),
      'Date of birth cannot be in the future',
    ),
  address_line_1: z.string().max(500, 'Address must be 500 characters or fewer'),
  address_line_2: z.string().max(500, 'Address must be 500 characters or fewer'),
  mandal_village: z.string().max(100, 'Must be 100 characters or fewer'),
  pincode: optionalFormat(PIN_RE, 'PIN code must be 6 digits and cannot start with 0'),
  remarks: z.string(),
})

type FormValues = z.infer<typeof Schema>

const DEFAULTS: FormValues = {
  full_name: '',
  mobile_number: '',
  alt_mobile_number: '',
  aadhaar_number: '',
  pan_number: '',
  date_of_birth: null,
  address_line_1: '',
  address_line_2: '',
  mandal_village: '',
  pincode: '',
  remarks: '',
}

// --------------------------------------------------
// Error mapping
// --------------------------------------------------

function mapCreateError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 409) {
      return detail ?? 'A customer with these details already exists.'
    }
    if (status === 422) {
      return detail ?? 'Please check the highlighted fields and try again.'
    }
    if (status === 403) {
      return detail ?? 'You do not have permission to create this customer.'
    }
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection and try again.'
  }
  return 'Something went wrong creating the customer. Please try again.'
}

// --------------------------------------------------
// Page
// --------------------------------------------------

export function CustomerCreatePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canPickAssignee = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const createMutation = useCreateCustomer()
  const [assignee, setAssignee] = useState<EmployeeResponse | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: DEFAULTS,
  })

  const submitError = createMutation.isError
    ? mapCreateError(createMutation.error)
    : null

  const onSubmit = (values: FormValues) => {
    const stripEmpty = (s: string) => (s.trim() === '' ? undefined : s.trim())
    const payload: CustomerCreate = {
      full_name: values.full_name.trim(),
      mobile_number: values.mobile_number,
      alt_mobile_number: stripEmpty(values.alt_mobile_number),
      aadhaar_number: stripEmpty(values.aadhaar_number),
      pan_number: stripEmpty(values.pan_number),
      date_of_birth: values.date_of_birth
        ? values.date_of_birth.format('YYYY-MM-DD')
        : undefined,
      address_line_1: stripEmpty(values.address_line_1),
      address_line_2: stripEmpty(values.address_line_2),
      mandal_village: stripEmpty(values.mandal_village),
      pincode: stripEmpty(values.pincode),
      remarks: stripEmpty(values.remarks),
      assigned_employee_id: canPickAssignee ? (assignee?.id ?? undefined) : undefined,
    }

    createMutation.mutate(payload, {
      onSuccess: (created) => {
        navigate({
          to: '/customers/$customerId',
          params: { customerId: created.id },
        })
      },
      onError: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    })
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      sx={{ maxWidth: 800, mx: 'auto' }}
    >
      {submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={submitError} />
        </Box>
      )}

      <Stack spacing={3}>
        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Personal info
          </Typography>
          <Stack spacing={2.5}>
            <Input
              id="full_name"
              label="Full name"
              required
              autoComplete="off"
              {...register('full_name')}
              error={errors.full_name?.message}
            />

            <TwoColumn>
              <Input
                id="mobile_number"
                label="Mobile number"
                required
                placeholder="10 digits, starting 6/7/8/9"
                inputMode="numeric"
                autoComplete="off"
                {...register('mobile_number')}
                error={errors.mobile_number?.message}
              />
              <Input
                id="alt_mobile_number"
                label="Alternate mobile"
                placeholder="Optional"
                inputMode="numeric"
                autoComplete="off"
                {...register('alt_mobile_number')}
                error={errors.alt_mobile_number?.message}
              />
            </TwoColumn>

            <TwoColumn>
              <Controller
                control={control}
                name="date_of_birth"
                render={({ field, fieldState }) => (
                  <Box>
                    <FieldLabel htmlFor="date_of_birth">Date of birth</FieldLabel>
                    <DatePicker
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      format="DD MMM YYYY"
                      maxDate={dayjs()}
                      views={['year', 'month', 'day']}
                      openTo="year"
                      slotProps={{
                        textField: {
                          id: 'date_of_birth',
                          size: 'small',
                          fullWidth: true,
                          error: !!fieldState.error,
                        },
                      }}
                    />
                    {fieldState.error?.message && (
                      <Typography
                        role="alert"
                        sx={{
                          mt: 0.5,
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'error.main',
                        }}
                      >
                        {fieldState.error.message}
                      </Typography>
                    )}
                  </Box>
                )}
              />
              <Box />
            </TwoColumn>

            <TwoColumn>
              <Input
                id="aadhaar_number"
                label="Aadhaar number"
                placeholder="12 digits"
                inputMode="numeric"
                autoComplete="off"
                {...register('aadhaar_number')}
                error={errors.aadhaar_number?.message}
              />
              <Input
                id="pan_number"
                label="PAN"
                placeholder="AAAAA9999A"
                autoComplete="off"
                {...register('pan_number')}
                error={errors.pan_number?.message}
              />
            </TwoColumn>
          </Stack>
        </Card>

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Address
          </Typography>
          <Stack spacing={2.5}>
            <Input
              id="address_line_1"
              label="Address line 1"
              placeholder="Optional"
              {...register('address_line_1')}
              error={errors.address_line_1?.message}
            />
            <Input
              id="address_line_2"
              label="Address line 2"
              placeholder="Optional"
              {...register('address_line_2')}
              error={errors.address_line_2?.message}
            />
            <TwoColumn>
              <Input
                id="mandal_village"
                label="Mandal / Village"
                placeholder="Optional"
                {...register('mandal_village')}
                error={errors.mandal_village?.message}
              />
              <Input
                id="pincode"
                label="PIN code"
                placeholder="6 digits"
                inputMode="numeric"
                {...register('pincode')}
                error={errors.pincode?.message}
              />
            </TwoColumn>
          </Stack>
        </Card>

        {canPickAssignee && (
          <Card>
            <Typography variant="h3" sx={{ mb: 2 }}>
              Assignment
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Leave blank to create unassigned. Customers can be reassigned later.
            </Typography>
            <EmployeePicker value={assignee} onChange={setAssignee} />
          </Card>
        )}

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Remarks
          </Typography>
          <Input
            id="remarks"
            placeholder="Any notes about this customer (optional)"
            multiline
            minRows={3}
            maxRows={8}
            {...register('remarks')}
            error={errors.remarks?.message}
          />
        </Card>

        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'flex-end' }}
        >
          <Btn
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: '/customers', search: { page: 1 } })}
            disabled={createMutation.isPending}
          >
            Cancel
          </Btn>
          <Btn
            type="submit"
            variant="primary"
            loading={createMutation.isPending}
          >
            Create customer
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

function TwoColumn({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: 2.5,
      }}
    >
      {children}
    </Box>
  )
}
