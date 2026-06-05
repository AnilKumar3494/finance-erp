import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useLoan, useUpdateLoan, type LoanUpdate } from '@/api/queries/loans'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { PRINCIPAL_RANGE, RATE_RANGE, TENURE_MONTHS_RANGE } from '@/schemas/primitives'
import { useReportDirty } from '@/features/loans/wizard/wizardGuard'

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

function parseAmount(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function mapErr(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (error.response?.status === 403) return detail ?? 'You do not have permission to edit this finance.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not save the financial details. Please try again.'
}

interface FinFormValues {
  principal: string
  interest_rate: string
  tenure: string
  down_payment: string
  processing_fee: string
  documentation_fee: string
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

  return <FinancialsForm financeId={financeId} loan={loanQuery.data} />
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
          principal: z.string(),
          interest_rate: z.string(),
          tenure: z.string(),
          down_payment: z.string(),
          processing_fee: z.string(),
          documentation_fee: z.string(),
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
          for (const key of ['down_payment', 'processing_fee', 'documentation_fee'] as const) {
            if (v[key].trim() === '') continue
            const amt = parseAmount(v[key])
            if (amt === null || amt < 0) {
              ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a valid amount' })
            }
          }
          const dp = parseAmount(v.down_payment)
          if (dp !== null && principal !== null && dp >= principal) {
            ctx.addIssue({ code: 'custom', path: ['down_payment'], message: 'Down payment must be less than the principal' })
          }
        }),
    [],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FinFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      principal: loan.principal ?? '',
      interest_rate: loan.interest_rate ?? '',
      tenure: loan.tenure != null ? String(loan.tenure) : '',
      down_payment: loan.down_payment ?? '',
      processing_fee: loan.processing_fee ?? '',
      documentation_fee: loan.documentation_fee ?? '',
    },
  })

  // This form stays mounted and editable after a save, so make the saved values
  // the new pristine baseline; the wizard's guard then only warns on fresh edits.
  useReportDirty(isDirty)

  const onSubmit = (v: FinFormValues) => {
    const feeOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim())
    const payload: LoanUpdate = {
      principal: v.principal.trim(),
      interest_rate: v.interest_rate.trim(),
      tenure: Number(v.tenure),
      down_payment: feeOrUndef(v.down_payment),
      processing_fee: feeOrUndef(v.processing_fee),
      documentation_fee: feeOrUndef(v.documentation_fee),
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
        Enter the loan terms. Once saved, an admin can approve the finance (the down
        payment mode is captured at approval).
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
          <Input
            id="fin_dp"
            label="Down payment"
            inputMode="decimal"
            placeholder="0"
            hint="Must be less than the principal"
            {...register('down_payment')}
            error={errors.down_payment?.message}
          />
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
