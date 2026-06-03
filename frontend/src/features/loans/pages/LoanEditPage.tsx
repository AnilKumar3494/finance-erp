import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  useLoan,
  useUpdateLoan,
  type LoanResponse,
  type LoanUpdate,
} from '@/api/queries/loans'
import type { VehicleResponse } from '@/api/queries/vehicles'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { VehiclePicker } from '@/features/loans/components/VehiclePicker'
import {
  PRINCIPAL_RANGE,
  RATE_RANGE,
  TENURE_MONTHS_RANGE,
} from '@/schemas/primitives'

const PENALTY_MAX = 1000
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
    penalty_rate: z.string(),
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
    if (tenure === null || !Number.isInteger(tenure)) {
      ctx.addIssue({ code: 'custom', path: ['tenure'], message: 'Tenure must be a whole number of months' })
    } else if (tenure < TENURE_MONTHS_RANGE[0] || tenure > TENURE_MONTHS_RANGE[1]) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenure'],
        message: `Tenure must be between ${TENURE_MONTHS_RANGE[0]} and ${TENURE_MONTHS_RANGE[1]} months`,
      })
    }

    const amounts: Array<'down_payment' | 'processing_fee' | 'documentation_fee'> = [
      'down_payment',
      'processing_fee',
      'documentation_fee',
    ]
    for (const key of amounts) {
      const amt = parseAmount(v[key])
      if (amt === null || amt < 0) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a valid amount' })
      }
    }

    const dp = parseAmount(v.down_payment)
    if (dp !== null && principal !== null && dp >= principal) {
      ctx.addIssue({
        code: 'custom',
        path: ['down_payment'],
        message: 'Down payment must be less than the principal',
      })
    }

    const penalty = parseAmount(v.penalty_rate)
    if (penalty === null || penalty < 0 || penalty > PENALTY_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['penalty_rate'],
        message: `Penalty rate must be between 0% and ${PENALTY_MAX}%`,
      })
    }
  })

type FormValues = z.infer<typeof Schema>

function defaultsFromLoan(loan: LoanResponse): FormValues {
  return {
    principal: loan.principal ?? '',
    interest_rate: loan.interest_rate ?? '',
    tenure: loan.tenure != null ? String(loan.tenure) : '',
    down_payment: loan.down_payment,
    processing_fee: loan.processing_fee,
    documentation_fee: loan.documentation_fee,
    penalty_rate: loan.penalty_rate ?? '36',
  }
}

// Seed the VehiclePicker from the loan's nested collateral. Mirrors the
// customer-assignee synthesis in CustomerEditPage: only the displayed fields
// matter for the selected value; the rest are placeholders until the user
// picks a different vehicle.
function seedVehicle(loan: LoanResponse): VehicleResponse | null {
  const v = loan.vehicle
  if (!v) return null
  return {
    id: v.id,
    type: 'COLLATERAL',
    plate_number: v.plate_number,
    make: v.make,
    model: v.model,
    year: v.year,
    color: null,
    chassis_number: null,
    engine_number: null,
    market_value: '0',
    purchase_cost: '0',
    status: 'IN_YARD',
    is_deleted: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    created_by_id: null,
    updated_by_id: null,
    deleted_by_id: null,
  }
}

function mapEditError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 403) return detail ?? 'You do not have permission to make this change.'
    if (status === 404) return 'Loan not found.'
    if (status === 409) return detail ?? 'This loan can no longer be edited.'
    if (status === 422) return detail ?? 'Please check the highlighted fields and try again.'
    if (status === 400) return detail ?? 'Please check the loan details and try again.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection and try again.'
  }
  return 'Something went wrong saving changes. Please try again.'
}

interface LoanEditPageProps {
  loanId: string
}

export function LoanEditPage({ loanId }: LoanEditPageProps) {
  const navigate = useNavigate()
  const query = useLoan(loanId)
  const back = () => navigate({ to: '/finances/$loanId', params: { loanId } })

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message={mapEditError(query.error)} />
      ) : query.data ? (
        <EditForm loan={query.data} onCancel={back} onSaved={back} />
      ) : null}
    </Box>
  )
}

interface EditFormProps {
  loan: LoanResponse
  onCancel: () => void
  onSaved: () => void
}

function EditForm({ loan, onCancel, onSaved }: EditFormProps) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuper = user?.role === 'SUPER_ADMIN'

  const isDraft = loan.status === 'DRAFT'
  const isActive = loan.status === 'ACTIVE'
  const editable = isDraft || isActive

  const canEditCollateral = isDraft
  const canEditSensitive = isDraft || (isActive && isSuper)

  const updateMutation = useUpdateLoan(loan.id)
  const [vehicle, setVehicle] = useState<VehicleResponse | null>(() => seedVehicle(loan))
  const [noChanges, setNoChanges] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: defaultsFromLoan(loan),
  })

  if (!isAdmin) {
    return <ErrorBanner message="You do not have permission to edit loans." />
  }
  if (!editable) {
    return (
      <Stack spacing={2}>
        <ErrorBanner
          severity="info"
          variant="outlined"
          message={`This loan is ${loan.status} and can no longer be edited.`}
        />
        <Box>
          <Btn variant="ghost" onClick={onCancel}>
            Back to loan
          </Btn>
        </Box>
      </Stack>
    )
  }

  const onSubmit = (values: FormValues) => {
    setNoChanges(false)
    const payload = buildDiff(values, loan, vehicle, { canEditSensitive, canEditCollateral })
    if (Object.keys(payload).length === 0) {
      setNoChanges(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    updateMutation.mutate(payload, {
      onSuccess: () => onSaved(),
      onError: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    })
  }

  const submitError = updateMutation.isError ? mapEditError(updateMutation.error) : null

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={submitError} />
        </Box>
      )}
      {noChanges && !submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="info" variant="outlined" message="No changes to save." />
        </Box>
      )}
      {isActive && canEditSensitive && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner
            severity="warning"
            variant="outlined"
            message="Changing principal, rate, tenure, or down payment on an ACTIVE loan does not regenerate the existing schedule and affects the outstanding balance."
          />
        </Box>
      )}

      <Stack spacing={3}>
        {canEditCollateral && (
          <Card>
            <Typography variant="h3" sx={{ mb: 2 }}>
              Collateral
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Clear the picker to remove collateral, or choose a different vehicle.
            </Typography>
            <VehiclePicker value={vehicle} onChange={setVehicle} />
          </Card>
        )}

        {canEditSensitive ? (
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
                {...register('principal')}
                error={errors.principal?.message}
              />
              <TwoColumn>
                <Input
                  id="interest_rate"
                  label="Interest rate (% p.a.)"
                  required
                  inputMode="decimal"
                  {...register('interest_rate')}
                  error={errors.interest_rate?.message}
                />
                <Input
                  id="tenure"
                  label="Tenure (months)"
                  required
                  inputMode="numeric"
                  {...register('tenure')}
                  error={errors.tenure?.message}
                />
              </TwoColumn>
              <Input
                id="down_payment"
                label="Down payment"
                inputMode="decimal"
                hint="Must be less than the principal"
                {...register('down_payment')}
                error={errors.down_payment?.message}
              />
            </Stack>
          </Card>
        ) : (
          <Card>
            <Typography variant="body2" color="text.secondary">
              Principal, interest rate, tenure, and down payment can only be
              changed on an ACTIVE loan by a super-admin.
            </Typography>
          </Card>
        )}

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Fees and penalty
          </Typography>
          <Stack spacing={2.5}>
            <TwoColumn>
              <Input
                id="processing_fee"
                label="Processing fee"
                inputMode="decimal"
                {...register('processing_fee')}
                error={errors.processing_fee?.message}
              />
              <Input
                id="documentation_fee"
                label="Documentation fee"
                inputMode="decimal"
                {...register('documentation_fee')}
                error={errors.documentation_fee?.message}
              />
            </TwoColumn>
            <Input
              id="penalty_rate"
              label="Penalty rate (% per month)"
              required
              inputMode="decimal"
              hint="Default 36%. Applied to missed cycles."
              {...register('penalty_rate')}
              error={errors.penalty_rate?.message}
            />
          </Stack>
        </Card>

        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'flex-end' }}
        >
          <Btn type="button" variant="ghost" onClick={onCancel} disabled={updateMutation.isPending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={updateMutation.isPending}>
            Save changes
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

// --------------------------------------------------
// Diff payload — only changed, editable fields. Money/rate fields are
// compared numerically so re-typing "250000" for "250000.00" is a no-op.
// --------------------------------------------------

interface DiffFlags {
  canEditSensitive: boolean
  canEditCollateral: boolean
}

function buildDiff(
  values: FormValues,
  loan: LoanResponse,
  vehicle: VehicleResponse | null,
  flags: DiffFlags,
): LoanUpdate {
  const p: LoanUpdate = {}
  const numChanged = (input: string, orig: string) => Number(input) !== Number(orig)

  if (flags.canEditSensitive) {
    if (numChanged(values.principal, loan.principal ?? '')) p.principal = values.principal.trim()
    if (numChanged(values.interest_rate, loan.interest_rate ?? '')) {
      p.interest_rate = values.interest_rate.trim()
    }
    if (Number(values.tenure) !== (loan.tenure ?? NaN)) p.tenure = Number(values.tenure)
    if (numChanged(values.down_payment, loan.down_payment)) {
      p.down_payment = values.down_payment.trim()
    }
  }

  if (numChanged(values.processing_fee, loan.processing_fee)) {
    p.processing_fee = values.processing_fee.trim()
  }
  if (numChanged(values.documentation_fee, loan.documentation_fee)) {
    p.documentation_fee = values.documentation_fee.trim()
  }
  if (numChanged(values.penalty_rate, loan.penalty_rate ?? '36')) {
    p.penalty_rate = values.penalty_rate.trim()
  }

  if (flags.canEditCollateral) {
    const next = vehicle?.id ?? null
    if (next !== loan.vehicle_id) p.vehicle_id = next
  }

  return p
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
