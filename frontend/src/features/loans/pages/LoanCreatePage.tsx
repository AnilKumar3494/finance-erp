import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useCreateLoan, type LoanCreate } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'
import type { VehicleResponse } from '@/api/queries/vehicles'
import { Btn, Card, ErrorBanner, Input } from '@/components/primitives'
import { CustomerPicker } from '@/features/loans/components/CustomerPicker'
import { VehiclePicker } from '@/features/loans/components/VehiclePicker'
import { PAYMENT_METHOD_LABELS } from '@/features/loans/paymentMethodLabels'
import { PaymentMethod } from '@/schemas/enums'
import { PRINCIPAL_RANGE, RATE_RANGE, TENURE_MONTHS_RANGE } from '@/schemas/primitives'

// --------------------------------------------------
// Validation. Money/rate/tenure are kept as STRINGS in the form (matching
// the HTML <input>) and sent to the backend as strings to preserve Decimal
// precision — we only parse to Number for range validation, never for
// transmission. Customer/vehicle are managed as picker state, not RHF.
// --------------------------------------------------

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

function parseAmount(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const Schema = z
  .object({
    principal: z.string(),
    interest_rate: z.string(),
    tenure: z.string(),
    down_payment: z.string(),
    processing_fee: z.string(),
    documentation_fee: z.string(),
    dsc_fee: z.string(),
    rto_fee: z.string(),
    down_payment_mode: z.string(),
  })
  .superRefine((v, ctx) => {
    const principal = parseAmount(v.principal)
    if (principal === null) {
      ctx.addIssue({ code: 'custom', path: ['principal'], message: 'Enter the principal amount' })
    } else if (principal < PRINCIPAL_RANGE[0] || principal > PRINCIPAL_RANGE[1]) {
      ctx.addIssue({
        code: 'custom',
        path: ['principal'],
        message: `Principal must be between ${inr(PRINCIPAL_RANGE[0])} and ${inr(PRINCIPAL_RANGE[1])}`,
      })
    }

    const rate = parseAmount(v.interest_rate)
    if (rate === null) {
      ctx.addIssue({ code: 'custom', path: ['interest_rate'], message: 'Enter the interest rate' })
    } else if (rate < RATE_RANGE[0] || rate > RATE_RANGE[1]) {
      ctx.addIssue({
        code: 'custom',
        path: ['interest_rate'],
        message: `Rate must be between ${RATE_RANGE[0]}% and ${RATE_RANGE[1]}%`,
      })
    }

    const tenure = parseAmount(v.tenure)
    if (tenure === null) {
      ctx.addIssue({ code: 'custom', path: ['tenure'], message: 'Enter the tenure' })
    } else if (!Number.isInteger(tenure)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenure'],
        message: 'Tenure must be a whole number of months',
      })
    } else if (tenure < TENURE_MONTHS_RANGE[0] || tenure > TENURE_MONTHS_RANGE[1]) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenure'],
        message: `Tenure must be between ${TENURE_MONTHS_RANGE[0]} and ${TENURE_MONTHS_RANGE[1]} months`,
      })
    }

    const fees: Array<keyof typeof v> = [
      'down_payment',
      'processing_fee',
      'documentation_fee',
      'dsc_fee',
      'rto_fee',
    ]
    for (const key of fees) {
      const raw = v[key]
      if (raw.trim() === '') continue
      const amt = parseAmount(raw)
      if (amt === null || amt < 0) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a valid amount' })
      }
    }

    const dp = parseAmount(v.down_payment)
    if (dp !== null && dp >= 0 && principal !== null && dp >= principal) {
      ctx.addIssue({
        code: 'custom',
        path: ['down_payment'],
        message: 'Down payment must be less than the principal',
      })
    }

    // Backend requires a mode whenever there is a down payment.
    if (dp !== null && dp > 0) {
      if (!PaymentMethod.safeParse(v.down_payment_mode).success) {
        ctx.addIssue({
          code: 'custom',
          path: ['down_payment_mode'],
          message: 'Select how the down payment was received',
        })
      }
    }
  })

type FormValues = z.infer<typeof Schema>

const DEFAULTS: FormValues = {
  principal: '',
  interest_rate: '',
  tenure: '',
  down_payment: '',
  processing_fee: '',
  documentation_fee: '',
  dsc_fee: '',
  rto_fee: '',
  down_payment_mode: '',
}

function mapCreateError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 400) return detail ?? 'Please check the loan details and try again.'
    if (status === 409) return detail ?? 'A loan with these details already exists.'
    if (status === 422) return detail ?? 'Please check the highlighted fields and try again.'
    if (status === 403) return detail ?? 'You do not have permission to create this loan.'
    if (status === 404) return detail ?? 'The selected customer or vehicle was not found.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection and try again.'
  }
  return 'Something went wrong creating the loan. Please try again.'
}

export function LoanCreatePage() {
  const navigate = useNavigate()
  const createMutation = useCreateLoan()

  const [customer, setCustomer] = useState<CustomerResponse | null>(null)
  const [vehicle, setVehicle] = useState<VehicleResponse | null>(null)
  const [customerError, setCustomerError] = useState<string>()

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: DEFAULTS,
  })

  const submitError = createMutation.isError ? mapCreateError(createMutation.error) : null
  const showDpMode = (parseAmount(watch('down_payment')) ?? 0) > 0

  const onSubmit = (values: FormValues) => {
    if (!customer) {
      setCustomerError('Select a customer')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    const feeOrUndef = (s: string) => {
      const n = parseAmount(s)
      return n !== null && n > 0 ? s.trim() : undefined
    }
    const dp = parseAmount(values.down_payment)
    const hasDp = dp !== null && dp > 0

    const payload: LoanCreate = {
      customer_id: customer.id,
      vehicle_id: vehicle?.id ?? undefined,
      principal: values.principal.trim(),
      interest_rate: values.interest_rate.trim(),
      tenure: Number(values.tenure),
      down_payment: hasDp ? values.down_payment.trim() : undefined,
      processing_fee: feeOrUndef(values.processing_fee),
      documentation_fee: feeOrUndef(values.documentation_fee),
      dsc_fee: feeOrUndef(values.dsc_fee),
      rto_fee: feeOrUndef(values.rto_fee),
      down_payment_mode: hasDp
        ? (values.down_payment_mode as LoanCreate['down_payment_mode'])
        : undefined,
    }

    createMutation.mutate(payload, {
      onSuccess: (created) => {
        navigate({ to: '/finances/$loanId', params: { loanId: created.id } })
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
            Parties
          </Typography>
          <Stack spacing={2.5}>
            <CustomerPicker
              value={customer}
              onChange={(c) => {
                setCustomer(c)
                if (c) setCustomerError(undefined)
              }}
              required
              error={customerError}
            />
            <VehiclePicker value={vehicle} onChange={setVehicle} />
          </Stack>
        </Card>

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Loan terms
          </Typography>
          <Stack spacing={2.5}>
            <Input
              id="principal"
              label="Principal"
              required
              inputMode="decimal"
              placeholder="e.g. 250000"
              hint={`Between ${inr(PRINCIPAL_RANGE[0])} and ${inr(PRINCIPAL_RANGE[1])}`}
              {...register('principal')}
              error={errors.principal?.message}
            />
            <TwoColumn>
              <Input
                id="interest_rate"
                label="Interest rate (% p.a.)"
                required
                inputMode="decimal"
                placeholder="e.g. 18"
                hint={`${RATE_RANGE[0]}% – ${RATE_RANGE[1]}%`}
                {...register('interest_rate')}
                error={errors.interest_rate?.message}
              />
              <Input
                id="tenure"
                label="Tenure (months)"
                required
                inputMode="numeric"
                placeholder="e.g. 24"
                hint={`${TENURE_MONTHS_RANGE[0]} – ${TENURE_MONTHS_RANGE[1]} months`}
                {...register('tenure')}
                error={errors.tenure?.message}
              />
            </TwoColumn>
          </Stack>
        </Card>

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Fees and down payment
          </Typography>
          <Stack spacing={2.5}>
            <TwoColumn>
              <Input
                id="processing_fee"
                label="Processing fee"
                inputMode="decimal"
                placeholder="0"
                {...register('processing_fee')}
                error={errors.processing_fee?.message}
              />
              <Input
                id="documentation_fee"
                label="Documentation fee"
                inputMode="decimal"
                placeholder="0"
                {...register('documentation_fee')}
                error={errors.documentation_fee?.message}
              />
            </TwoColumn>
            <TwoColumn>
              <Input
                id="dsc_fee"
                label="DSC fee"
                inputMode="decimal"
                placeholder="0"
                {...register('dsc_fee')}
                error={errors.dsc_fee?.message}
              />
              <Input
                id="rto_fee"
                label="RTO fee"
                inputMode="decimal"
                placeholder="0"
                {...register('rto_fee')}
                error={errors.rto_fee?.message}
              />
            </TwoColumn>
            <TwoColumn>
              <Input
                id="down_payment"
                label="Down payment"
                inputMode="decimal"
                placeholder="0"
                hint="Must be less than the principal"
                {...register('down_payment')}
                error={errors.down_payment?.message}
              />
              {showDpMode && (
                <Controller
                  control={control}
                  name="down_payment_mode"
                  render={({ field, fieldState }) => (
                    <Input
                      select
                      id="down_payment_mode"
                      label="Down payment mode"
                      required
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                    >
                      {PaymentMethod.options.map((m) => (
                        <MenuItem key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </MenuItem>
                      ))}
                    </Input>
                  )}
                />
              )}
            </TwoColumn>
          </Stack>
        </Card>

        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'flex-end' }}
        >
          <Btn
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
            disabled={createMutation.isPending}
          >
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={createMutation.isPending}>
            Create loan
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
