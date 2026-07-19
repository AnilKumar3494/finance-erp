import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useLoan, useUpdateLoan, type LoanUpdate } from '@/api/queries/loans'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { WizardAssignmentCard } from '@/features/loans/wizard/AssignmentCard'
import { PRINCIPAL_RANGE, RATE_RANGE, TENURE_MONTHS_RANGE } from '@/schemas/primitives'
import { useReportDirty } from '@/features/loans/wizard/wizardGuard'
import { flatRateProjection } from '@/features/loans/financeMath'
import { IrrSheetView } from '@/features/loans/irrSheet/IrrSheetView'
import { fmtINR } from '@/lib/format'

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

function parseAmount(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function mapErr(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 403)
      return detail ?? 'You do not have permission to edit this finance.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not save the financial details. Please try again.'
}

interface FinFormValues {
  hp_number: string
  principal: string
  interest_rate: string
  tenure: string
  down_payment: string
  processing_fee: string
  documentation_fee: string
  dsc_fee: string
  rto_fee: string
}

export function FinancialsSection({ financeId }: { financeId: string }) {
  const loanQuery = useLoan(financeId)

  if (loanQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (loanQuery.isError || !loanQuery.data) {
    return <ErrorBanner message="Could not load this finance." />
  }

  return (
    <Stack spacing={3}>
      <FinancialsForm financeId={financeId} loan={loanQuery.data} />
      <WizardAssignmentCard customerId={loanQuery.data.customer_id} />
    </Stack>
  )
}

function FinancialsForm({
  financeId,
  loan,
}: {
  financeId: string
  loan: NonNullable<ReturnType<typeof useLoan>['data']>
}) {
  const update = useUpdateLoan(financeId)

  const schema = useMemo(
    () =>
      z
        .object({
          hp_number: z.string(),
          principal: z.string(),
          interest_rate: z.string(),
          tenure: z.string(),
          down_payment: z.string(),
          processing_fee: z.string(),
          documentation_fee: z.string(),
          dsc_fee: z.string(),
          rto_fee: z.string(),
        })
        .superRefine((v, ctx) => {
          if (v.hp_number.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['hp_number'], message: 'Enter the HP number' })
          } else if (v.hp_number.trim().length > 30) {
            ctx.addIssue({
              code: 'custom',
              path: ['hp_number'],
              message: 'HP number is too long (max 30 characters)',
            })
          }
          const principal = parseAmount(v.principal)
          if (principal === null) {
            ctx.addIssue({
              code: 'custom',
              path: ['principal'],
              message: 'Enter the principal amount',
            })
          } else if (principal < PRINCIPAL_RANGE[0] || principal > PRINCIPAL_RANGE[1]) {
            ctx.addIssue({
              code: 'custom',
              path: ['principal'],
              message: `Principal must be between ${inr(PRINCIPAL_RANGE[0])} and ${inr(PRINCIPAL_RANGE[1])}`,
            })
          }
          const rate = parseAmount(v.interest_rate)
          if (rate === null) {
            ctx.addIssue({
              code: 'custom',
              path: ['interest_rate'],
              message: 'Enter the interest rate',
            })
          } else if (rate < RATE_RANGE[0] || rate > RATE_RANGE[1]) {
            ctx.addIssue({
              code: 'custom',
              path: ['interest_rate'],
              message: `Rate must be between ${RATE_RANGE[0]}% and ${RATE_RANGE[1]}%`,
            })
          }
          const tenure = parseAmount(v.tenure)
          if (tenure === null || !Number.isInteger(tenure)) {
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
          for (const key of [
            'down_payment',
            'processing_fee',
            'documentation_fee',
            'dsc_fee',
            'rto_fee',
          ] as const) {
            if (v[key].trim() === '') continue
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
        }),
    [],
  )

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FinFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      hp_number: loan.hp_number ?? '',
      principal: loan.principal ?? '',
      interest_rate: loan.interest_rate ?? '',
      tenure: loan.tenure != null ? String(loan.tenure) : '',
      down_payment: loan.down_payment ?? '',
      processing_fee: loan.processing_fee ?? '',
      documentation_fee: loan.documentation_fee ?? '',
      dsc_fee: loan.dsc_fee ?? '',
      rto_fee: loan.rto_fee ?? '',
    },
  })

  // This form stays mounted and editable after a save, so make the saved values
  // the new pristine baseline; the wizard's guard then only warns on fresh edits.
  useReportDirty(isDirty)

  // Live, indicative projection the employee can quote to the customer. Computed
  // client-side from the current inputs (flat-rate); the backend's saved figures
  // are authoritative.
  const [wPrincipal, wRate, wTenure, wDown] = watch([
    'principal',
    'interest_rate',
    'tenure',
    'down_payment',
  ])
  const projection = flatRateProjection({
    principal: Number(parseAmount(wPrincipal) ?? NaN),
    annualRatePct: Number(parseAmount(wRate) ?? NaN),
    tenureMonths: Number(parseAmount(wTenure) ?? NaN),
    downPayment: parseAmount(wDown) ?? 0,
  })

  const onSubmit = (v: FinFormValues) => {
    const feeOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim())
    const payload: LoanUpdate = {
      hp_number: v.hp_number.trim().toUpperCase(),
      principal: v.principal.trim(),
      interest_rate: v.interest_rate.trim(),
      tenure: Number(v.tenure),
      down_payment: feeOrUndef(v.down_payment),
      processing_fee: feeOrUndef(v.processing_fee),
      documentation_fee: feeOrUndef(v.documentation_fee),
      dsc_fee: feeOrUndef(v.dsc_fee),
      rto_fee: feeOrUndef(v.rto_fee),
    }
    update.mutate(payload, { onSuccess: () => reset(v) })
  }

  const error = update.isError ? mapErr(update.error) : null

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Financial details
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter the loan terms. Once saved, an admin can approve the finance (the down payment mode is
        captured at approval).
      </Typography>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && (
          <Box sx={{ mb: 2 }}>
            <ErrorBanner message={error} />
          </Box>
        )}
        {update.isSuccess && !error && (
          <Box sx={{ mb: 2 }}>
            <ErrorBanner severity="success" variant="outlined" message="Financial details saved." />
          </Box>
        )}
        <Stack spacing={2.5}>
          <Input
            id="fin_hp_number"
            label="HP number"
            required
            placeholder="e.g. SAFTNK0401"
            hint="Hire-purchase number — shown as this finance's ID. Required to approve."
            {...register('hp_number')}
            error={errors.hp_number?.message}
          />
          <Input
            id="fin_principal"
            label="Principal"
            required
            inputMode="decimal"
            hint={`Between ${inr(PRINCIPAL_RANGE[0])} and ${inr(PRINCIPAL_RANGE[1])}`}
            {...register('principal')}
            error={errors.principal?.message}
          />
          <TwoCol>
            <Input
              id="fin_rate"
              label="Interest rate (% p.a.)"
              required
              inputMode="decimal"
              hint={`${RATE_RANGE[0]}% – ${RATE_RANGE[1]}%`}
              {...register('interest_rate')}
              error={errors.interest_rate?.message}
            />
            <Input
              id="fin_tenure"
              label="Tenure (months)"
              required
              inputMode="numeric"
              hint={`${TENURE_MONTHS_RANGE[0]} – ${TENURE_MONTHS_RANGE[1]} months`}
              {...register('tenure')}
              error={errors.tenure?.message}
            />
          </TwoCol>
          <TwoCol>
            <Input
              id="fin_processing"
              label="Processing fee"
              inputMode="decimal"
              placeholder="0"
              {...register('processing_fee')}
              error={errors.processing_fee?.message}
            />
            <Input
              id="fin_doc"
              label="Documentation fee"
              inputMode="decimal"
              placeholder="0"
              {...register('documentation_fee')}
              error={errors.documentation_fee?.message}
            />
          </TwoCol>
          <TwoCol>
            <Input
              id="fin_dsc"
              label="DSC fee"
              inputMode="decimal"
              placeholder="0"
              {...register('dsc_fee')}
              error={errors.dsc_fee?.message}
            />
            <Input
              id="fin_rto"
              label="RTO fee"
              inputMode="decimal"
              placeholder="0"
              {...register('rto_fee')}
              error={errors.rto_fee?.message}
            />
          </TwoCol>
          <Input
            id="fin_dp"
            label="Down payment"
            inputMode="decimal"
            placeholder="0"
            hint="Must be less than the principal"
            {...register('down_payment')}
            error={errors.down_payment?.message}
          />
          {projection && (
            <ProjectionPreview
              projection={projection}
              principal={Number(parseAmount(wPrincipal) ?? NaN)}
              flatRatePct={Number(parseAmount(wRate) ?? NaN)}
              tenureMonths={Number(parseAmount(wTenure) ?? NaN)}
            />
          )}
          <Box>
            <Btn type="submit" variant="primary" loading={update.isPending}>
              {update.isSuccess ? 'Update financial details' : 'Save financial details'}
            </Btn>
          </Box>
          {update.isSuccess && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                This finance is ready to be approved.
              </Typography>
            </Stack>
          )}
        </Stack>
      </Box>
    </Card>
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}

// Indicative figures the employee can share with the customer. Recomputes live
// as the form changes; final values are set by the backend on save/approval.
//
// The true-rate band below the stats is deliberately explain-by-default: this
// panel is turned around and shown to the customer (see its caption), and a bare
// "36.74%" next to a rate they were quoted as 21% invites exactly the question
// the chart answers.
function ProjectionPreview({
  projection,
  principal,
  flatRatePct,
  tenureMonths,
}: {
  projection: NonNullable<ReturnType<typeof flatRateProjection>>
  principal: number
  flatRatePct: number
  tenureMonths: number
}) {
  // The backend lets the last instalment absorb the rounding remainder
  // (services/finance.py `emi_schedule`); reconstruct it so this estimate lines
  // up with the schedule the loan will actually get on approval.
  const finalEmi = projection.totalPayable - projection.emi * (tenureMonths - 1)

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Estimate to share with the customer — final figures are confirmed on approval.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        <Stat label="EMI / month" value={fmtINR(projection.emi)} strong />
        <Stat label="Total interest" value={fmtINR(projection.totalInterest)} />
        <Stat label="Total payable" value={fmtINR(projection.totalPayable)} />
        <Stat label="Financed amount" value={fmtINR(projection.netPrincipal)} />
      </Box>
      <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <IrrSheetView
          input={{
            principal,
            flatRatePct,
            tenureMonths,
            emi: projection.emi,
            finalEmi,
          }}
        />
      </Box>
    </Box>
  )
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography
        variant="body1"
        sx={{ fontWeight: strong ? 700 : 600, fontSize: strong ? 18 : 16 }}
      >
        {value}
      </Typography>
    </Box>
  )
}
