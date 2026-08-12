import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import dayjs, { type Dayjs } from 'dayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useUpdateLoan, type LoanResponse, type LoanUpdate } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, FieldLabel, Input } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { PRINCIPAL_RANGE, RATE_RANGE, TENURE_MONTHS_RANGE } from '@/schemas/primitives'
import { EditableSection } from '../components/EditableSection'
import { FieldGrid, FieldRow } from '../components/DetailFields'
import type { SectionPermission } from '../financePermissions'
import type { ApprovalMissingField } from '../approvalReadiness'

const PENALTY_MAX = 1000
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const money = (v: string | null) => (v != null ? fmtINR(Number(v)) : undefined)

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
      return detail ?? 'You do not have permission to edit these terms.'
    if (error.response?.status === 409) return detail ?? 'These terms can no longer be edited.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not save the loan terms. Please try again.'
}

export function FinanceInfoSection({
  loan,
  perm,
  openSignal,
  missing,
}: {
  loan: LoanResponse
  perm: SectionPermission
  openSignal?: number
  missing?: ApprovalMissingField[]
}) {
  const highlight = new Set(missing?.map((m) => m.field))
  // Sensitive terms (principal/rate/tenure/down payment) follow the backend
  // rule: editable on DRAFT, or on ACTIVE only by a super-admin.
  const { user } = useAuth()
  const isSuper = user?.role === 'SUPER_ADMIN'
  const isAdmin = user?.role === 'ADMIN' || isSuper
  const canEditSensitive = loan.status === 'DRAFT' || (loan.status === 'ACTIVE' && isSuper)
  // The due date re-anchors the schedule, so unlike principal/tenure it stays
  // editable on an ACTIVE loan — by any admin, not just super-admin.
  const canEditDueDate = loan.status === 'DRAFT' || (loan.status === 'ACTIVE' && isAdmin)

  const warning =
    perm.warning ??
    'Changing loan terms affects the repayment schedule and outstanding balance. This is recorded in the audit trail.'

  return (
    <EditableSection
      title="Finance Terms"
      sectionId="sec-finance"
      openSignal={openSignal}
      missing={missing?.map((m) => m.label)}
      subtitle={
        [
          money(loan.principal),
          loan.interest_rate != null ? `${loan.interest_rate}% p.a.` : null,
          loan.tenure != null ? `${loan.tenure} months` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      canEdit={perm.canEdit}
      warning={warning}
      view={<FinanceView loan={loan} />}
      edit={(done) => (
        <FinanceEditForm
          loan={loan}
          canEditSensitive={canEditSensitive}
          canEditDueDate={canEditDueDate}
          onDone={done}
          highlight={highlight}
        />
      )}
    />
  )
}

function FinanceView({ loan }: { loan: LoanResponse }) {
  // EMI = total payable / tenure, both computed by the backend. Shown so staff
  // can quote the monthly instalment without opening the schedule.
  const emi =
    loan.total_payable != null && loan.tenure
      ? fmtINR(Number(loan.total_payable) / loan.tenure)
      : undefined
  return (
    <FieldGrid>
      <FieldRow label="HP number" value={loan.hp_number ?? undefined} />
      <FieldRow label="Principal" value={money(loan.principal)} />
      <FieldRow
        label="Interest rate"
        value={loan.interest_rate != null ? `${loan.interest_rate}% p.a.` : undefined}
      />
      <FieldRow label="Tenure" value={loan.tenure != null ? `${loan.tenure} months` : undefined} />
      <FieldRow label="EMI amount" value={emi} />
      <FieldRow label="Monthly interest" value={money(loan.monthly_interest)} />
      <FieldRow label="Total payable" value={money(loan.total_payable)} />
      <FieldRow label="Down payment" value={fmtINR(Number(loan.down_payment))} />
      <FieldRow label="Processing fee" value={fmtINR(Number(loan.processing_fee))} />
      <FieldRow label="Documentation fee" value={fmtINR(Number(loan.documentation_fee))} />
      <FieldRow label="DSC fee" value={fmtINR(Number(loan.dsc_fee))} />
      <FieldRow label="RTO fee" value={fmtINR(Number(loan.rto_fee))} />
      <FieldRow label="Net loan principal" value={money(loan.net_loan_principal)} />
      <FieldRow label="Net disbursed amount" value={money(loan.net_disbursed_amount)} />
      <FieldRow
        label="Penalty rate"
        value={loan.penalty_rate != null ? `${loan.penalty_rate}% per month` : undefined}
      />
      <FieldRow label="Due date" value={fmtDate(loan.first_emi_date) || undefined} />
      <FieldRow label="Approval date" value={fmtDate(loan.approval_date) || undefined} />
      <FieldRow
        label="Due day of month"
        value={loan.due_day_of_month != null ? String(loan.due_day_of_month) : undefined}
      />
    </FieldGrid>
  )
}

// --------------------------------------------------
// Edit form — mirrors LoanEditPage's terms/fees/penalty validation.
// --------------------------------------------------

interface FormValues {
  hp_number: string
  principal: string
  interest_rate: string
  tenure: string
  first_emi_date: Dayjs | null
  down_payment: string
  processing_fee: string
  documentation_fee: string
  dsc_fee: string
  rto_fee: string
  penalty_rate: string
}

function FinanceEditForm({
  loan,
  canEditSensitive,
  canEditDueDate,
  onDone,
  highlight,
}: {
  loan: LoanResponse
  canEditSensitive: boolean
  canEditDueDate: boolean
  onDone: () => void
  highlight?: Set<string>
}) {
  const update = useUpdateLoan(loan.id)
  const isActive = loan.status === 'ACTIVE'

  const schema = useMemo(
    () =>
      z
        .object({
          hp_number: z.string(),
          principal: z.string(),
          interest_rate: z.string(),
          tenure: z.string(),
          first_emi_date: z.custom<Dayjs | null>().nullable(),
          down_payment: z.string(),
          processing_fee: z.string(),
          documentation_fee: z.string(),
          dsc_fee: z.string(),
          rto_fee: z.string(),
          penalty_rate: z.string(),
        })
        .superRefine((v, ctx) => {
          if (v.first_emi_date !== null && !v.first_emi_date.isValid()) {
            ctx.addIssue({
              code: 'custom',
              path: ['first_emi_date'],
              message: 'Enter a complete date, or clear the field',
            })
          } else if (isActive && canEditDueDate && v.first_emi_date === null) {
            ctx.addIssue({
              code: 'custom',
              path: ['first_emi_date'],
              message: 'An active finance must keep a due date',
            })
          }
          if (v.hp_number.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['hp_number'], message: 'Enter the HP number' })
          } else if (v.hp_number.trim().length > 30) {
            ctx.addIssue({
              code: 'custom',
              path: ['hp_number'],
              message: 'HP number is too long (max 30 characters)',
            })
          }
          if (canEditSensitive) {
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
            const dp = parseAmount(v.down_payment)
            if (dp === null || dp < 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['down_payment'],
                message: 'Enter a valid amount',
              })
            } else if (principal !== null && dp >= principal) {
              ctx.addIssue({
                code: 'custom',
                path: ['down_payment'],
                message: 'Down payment must be less than the principal',
              })
            }
          }
          for (const key of [
            'processing_fee',
            'documentation_fee',
            'dsc_fee',
            'rto_fee',
          ] as const) {
            const amt = parseAmount(v[key])
            if (amt === null || amt < 0) {
              ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a valid amount' })
            }
          }
          const penalty = parseAmount(v.penalty_rate)
          if (penalty === null || penalty < 0 || penalty > PENALTY_MAX) {
            ctx.addIssue({
              code: 'custom',
              path: ['penalty_rate'],
              message: `Penalty rate must be between 0% and ${PENALTY_MAX}%`,
            })
          }
        }),
    [canEditSensitive, isActive, canEditDueDate],
  )

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      hp_number: loan.hp_number ?? '',
      principal: loan.principal ?? '',
      interest_rate: loan.interest_rate ?? '',
      tenure: loan.tenure != null ? String(loan.tenure) : '',
      first_emi_date: loan.first_emi_date ? dayjs(loan.first_emi_date) : null,
      down_payment: loan.down_payment,
      processing_fee: loan.processing_fee,
      documentation_fee: loan.documentation_fee,
      dsc_fee: loan.dsc_fee,
      rto_fee: loan.rto_fee,
      penalty_rate: loan.penalty_rate ?? '36',
    },
  })

  const onSubmit = (v: FormValues) => {
    const payload = buildDiff(v, loan, canEditSensitive, canEditDueDate)
    if (Object.keys(payload).length === 0) {
      onDone()
      return
    }
    update.mutate(payload, { onSuccess: () => onDone() })
  }

  const error = update.isError ? mapErr(update.error) : null

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <Input
          id="fin_hp_number"
          label="HP number"
          required
          placeholder="e.g. SAFTNK0401"
          hint="Hire-purchase number — shown as this finance's ID."
          {...register('hp_number')}
          error={errors.hp_number?.message}
        />
        {canEditSensitive ? (
          <>
            <Input
              id="fin_principal"
              label="Principal"
              required
              inputMode="decimal"
              highlight={highlight?.has('principal')}
              {...register('principal')}
              error={errors.principal?.message}
            />
            <TwoCol>
              <Input
                id="fin_rate"
                label="Interest rate (% p.a.)"
                required
                inputMode="decimal"
                highlight={highlight?.has('interest_rate')}
                {...register('interest_rate')}
                error={errors.interest_rate?.message}
              />
              <Input
                id="fin_tenure"
                label="Tenure (months)"
                required
                inputMode="numeric"
                highlight={highlight?.has('tenure')}
                {...register('tenure')}
                error={errors.tenure?.message}
              />
            </TwoCol>
            <Input
              id="fin_dp"
              label="Down payment"
              inputMode="decimal"
              hint="Must be less than the principal"
              {...register('down_payment')}
              error={errors.down_payment?.message}
            />
          </>
        ) : (
          <ErrorBanner
            severity="info"
            variant="outlined"
            message="Principal, interest rate, tenure, and down payment can only be changed on a DRAFT, or on an ACTIVE loan by a super-admin."
          />
        )}
        {canEditDueDate && (
          <Controller
            control={control}
            name="first_emi_date"
            render={({ field, fieldState }) => (
              <Box>
                <FieldLabel htmlFor="fin_first_emi" required={isActive}>
                  Due date
                </FieldLabel>
                <DatePicker
                  value={field.value}
                  onChange={(d) => field.onChange(d)}
                  format="DD MMM YYYY"
                  minDate={isActive && loan.approval_date ? dayjs(loan.approval_date) : undefined}
                  slotProps={{
                    textField: {
                      id: 'fin_first_emi',
                      size: 'small',
                      fullWidth: true,
                      error: !!fieldState.error,
                    },
                    // An active finance must keep a due date; only a draft may clear it.
                    field: { clearable: !isActive },
                  }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {isActive
                    ? 'When the first instalment is due. Changing it re-dates the whole schedule (cycle 1 onwards); recorded payments are kept.'
                    : 'When the first instalment is due. Required to approve — it sets the repayment schedule.'}
                </Typography>
                {fieldState.error?.message && (
                  <Typography
                    role="alert"
                    sx={{ mt: 0.5, fontSize: 11, fontWeight: 500, color: 'error.main' }}
                  >
                    {fieldState.error.message}
                  </Typography>
                )}
              </Box>
            )}
          />
        )}
        <TwoCol>
          <Input
            id="fin_processing"
            label="Processing fee"
            inputMode="decimal"
            {...register('processing_fee')}
            error={errors.processing_fee?.message}
          />
          <Input
            id="fin_doc"
            label="Documentation fee"
            inputMode="decimal"
            {...register('documentation_fee')}
            error={errors.documentation_fee?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id="fin_dsc"
            label="DSC fee"
            inputMode="decimal"
            {...register('dsc_fee')}
            error={errors.dsc_fee?.message}
          />
          <Input
            id="fin_rto"
            label="RTO fee"
            inputMode="decimal"
            {...register('rto_fee')}
            error={errors.rto_fee?.message}
          />
        </TwoCol>
        <Input
          id="fin_penalty"
          label="Penalty rate (% per month)"
          required
          inputMode="decimal"
          hint="Default 36%. Applied to missed cycles."
          {...register('penalty_rate')}
          error={errors.penalty_rate?.message}
        />

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onDone} disabled={update.isPending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={update.isPending}>
            Save terms
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

function buildDiff(
  v: FormValues,
  loan: LoanResponse,
  canEditSensitive: boolean,
  canEditDueDate: boolean,
): LoanUpdate {
  const p: LoanUpdate = {}
  const numChanged = (input: string, orig: string) => Number(input) !== Number(orig)

  const hp = v.hp_number.trim().toUpperCase()
  if (hp !== (loan.hp_number ?? '')) p.hp_number = hp

  if (canEditDueDate) {
    const iso =
      v.first_emi_date && v.first_emi_date.isValid() ? v.first_emi_date.format('YYYY-MM-DD') : null
    if (iso !== (loan.first_emi_date ?? null)) p.first_emi_date = iso
  }

  if (canEditSensitive) {
    if (numChanged(v.principal, loan.principal ?? '')) p.principal = v.principal.trim()
    if (numChanged(v.interest_rate, loan.interest_rate ?? ''))
      p.interest_rate = v.interest_rate.trim()
    if (Number(v.tenure) !== (loan.tenure ?? NaN)) p.tenure = Number(v.tenure)
    if (numChanged(v.down_payment, loan.down_payment)) p.down_payment = v.down_payment.trim()
  }
  if (numChanged(v.processing_fee, loan.processing_fee)) p.processing_fee = v.processing_fee.trim()
  if (numChanged(v.documentation_fee, loan.documentation_fee)) {
    p.documentation_fee = v.documentation_fee.trim()
  }
  if (numChanged(v.dsc_fee, loan.dsc_fee)) p.dsc_fee = v.dsc_fee.trim()
  if (numChanged(v.rto_fee, loan.rto_fee)) p.rto_fee = v.rto_fee.trim()
  if (numChanged(v.penalty_rate, loan.penalty_rate ?? '36')) p.penalty_rate = v.penalty_rate.trim()

  return p
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}
