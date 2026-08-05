import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs, { type Dayjs } from 'dayjs'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import { useCloseLoan, type LoanCloseRequest, type LoanResponse } from '@/api/queries/loans'
import { loanDisplayId } from '@/features/loans/loanIdentity'
import { useLoanSummary } from '@/api/queries/transactions'
import { Btn, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import type { ClosureType } from '@/schemas/enums'
import { fmtINR } from '@/lib/format'
import { optionalDate } from '@/schemas/primitives'

const CLOSURE_TYPE_LABELS: Record<ClosureType, string> = {
  NORMAL_TENURE: 'Normal (tenure completed)',
  EARLY_FORECLOSURE: 'Early foreclosure',
  NEGOTIATED_SETTLEMENT: 'Negotiated settlement',
  WRITE_OFF: 'Write-off (bad debt)',
}

function mapCloseError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 400) return detail ?? 'This loan cannot be closed with these values.'
    if (status === 403) return detail ?? 'You do not have permission to close this loan.'
    if (status === 404) return 'Loan not found.'
    if (status === 409) return detail ?? 'A closure already exists for this loan.'
    if (status === 422) return detail ?? 'Please check the highlighted fields and try again.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong closing the loan. Please try again.'
}

function parseAmount(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// amount_written_off the backend will require for the chosen type.
function computeWriteOff(type: ClosureType, outstanding: number, settlement: number): number {
  if (type === 'NEGOTIATED_SETTLEMENT') return Math.max(outstanding - settlement, 0)
  if (type === 'WRITE_OFF') return outstanding
  return 0
}

interface CloseActionProps {
  loan: LoanResponse
}

export function CloseAction({ loan }: CloseActionProps) {
  const [open, setOpen] = useState(false)
  const summary = useLoanSummary(loan.id, open)

  // The focus-restore pattern is simpler here since the dialog owns a large
  // form; we restore to the trigger button via its ref on close.
  const openDialog = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setOpen(true)
  }
  const closeDialog = () => setOpen(false)

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Finalise this loan: record the settlement, any write-off, charges, NOC,
        and refund. This is logged in the audit trail and cannot be undone.
      </Typography>
      <Btn variant="primary" onClick={openDialog}>
        Close loan
      </Btn>

      <Dialog
        open={open}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle>Close loan {loanDisplayId(loan)}</DialogTitle>
        {summary.isLoading ? (
          <DialogContent>
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <Spinner size={26} />
            </Box>
          </DialogContent>
        ) : summary.isError ? (
          <DialogContent>
            <ErrorBanner message={mapCloseError(summary.error)} />
          </DialogContent>
        ) : summary.data ? (
          <CloseForm
            loan={loan}
            outstanding={summary.data.outstanding}
            totalPaid={summary.data.total_paid}
            onCancel={closeDialog}
            onDone={closeDialog}
          />
        ) : null}
      </Dialog>
    </Box>
  )
}

interface CloseFormValues {
  closure_type: ClosureType | ''
  final_settlement_amount: string
  closing_charges: string
  charge_waived: boolean
  waiver_reason: string
  refund_due_to_customer: string
  refund_status: string
  noc_issued: boolean
  noc_reference: string
  closure_date: Dayjs | null
  closure_remarks: string
}

interface CloseFormProps {
  loan: LoanResponse
  outstanding: string
  totalPaid: string
  onCancel: () => void
  onDone: () => void
}

function CloseForm({ loan, outstanding, totalPaid, onCancel, onDone }: CloseFormProps) {
  const close = useCloseLoan(loan.id)
  const out = Number(outstanding)

  const availableTypes = useMemo<ClosureType[]>(() => {
    const set = new Set<ClosureType>()
    if (out === 0) {
      set.add('NORMAL_TENURE')
      set.add('EARLY_FORECLOSURE')
    }
    if (out > 0) {
      set.add('NEGOTIATED_SETTLEMENT')
      set.add('WRITE_OFF')
    }
    if (loan.status === 'BAD_DEBT_PROPOSED') set.add('WRITE_OFF')
    return (['NORMAL_TENURE', 'EARLY_FORECLOSURE', 'NEGOTIATED_SETTLEMENT', 'WRITE_OFF'] as const).filter(
      (t) => set.has(t),
    )
  }, [out, loan.status])

  const schema = useMemo(
    () =>
      z
        .object({
          closure_type: z.enum(['NORMAL_TENURE', 'EARLY_FORECLOSURE', 'NEGOTIATED_SETTLEMENT', 'WRITE_OFF']).or(z.literal('')),
          final_settlement_amount: z.string(),
          closing_charges: z.string(),
          charge_waived: z.boolean(),
          waiver_reason: z.string(),
          refund_due_to_customer: z.string(),
          refund_status: z.string(),
          noc_issued: z.boolean(),
          noc_reference: z.string(),
          closure_date: optionalDate,
          closure_remarks: z.string(),
        })
        .superRefine((v, ctx) => {
          if (v.closure_type === '') {
            ctx.addIssue({ code: 'custom', path: ['closure_type'], message: 'Select a closure type' })
            return
          }
          const isWriteOff = v.closure_type === 'WRITE_OFF'
          const isNegotiated = v.closure_type === 'NEGOTIATED_SETTLEMENT'

          const settlement = parseAmount(v.final_settlement_amount)
          if (!isWriteOff) {
            if (settlement === null || settlement < 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['final_settlement_amount'],
                message: 'Enter the final settlement amount',
              })
            } else if (isNegotiated && settlement > out) {
              ctx.addIssue({
                code: 'custom',
                path: ['final_settlement_amount'],
                message: `Settlement cannot exceed the outstanding (${fmtINR(out)})`,
              })
            }
          }

          if (!isWriteOff && v.closing_charges.trim() !== '') {
            const cc = parseAmount(v.closing_charges)
            if (cc === null || cc < 0) {
              ctx.addIssue({ code: 'custom', path: ['closing_charges'], message: 'Enter a valid amount' })
            } else if (v.charge_waived && cc > 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['closing_charges'],
                message: 'Closing charges must be 0 when waived',
              })
            }
          }

          if (v.charge_waived && v.waiver_reason.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['waiver_reason'], message: 'A waiver reason is required' })
          }
          if (v.noc_issued && v.noc_reference.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['noc_reference'], message: 'An NOC reference is required' })
          }

          if (v.refund_due_to_customer.trim() !== '') {
            const r = parseAmount(v.refund_due_to_customer)
            if (r === null || r < 0) {
              ctx.addIssue({ code: 'custom', path: ['refund_due_to_customer'], message: 'Enter a valid amount' })
            }
          }
        }),
    [out],
  )

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<CloseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      closure_type: availableTypes.length === 1 ? availableTypes[0] : '',
      final_settlement_amount: out === 0 ? totalPaid : '',
      closing_charges: '',
      charge_waived: false,
      waiver_reason: '',
      refund_due_to_customer: '',
      refund_status: '',
      noc_issued: false,
      noc_reference: '',
      closure_date: dayjs(),
      closure_remarks: '',
    },
  })

  const watchedType = watch('closure_type')
  const watchedSettlement = watch('final_settlement_amount')
  const chargeWaived = watch('charge_waived')
  const nocIssued = watch('noc_issued')
  const isWriteOff = watchedType === 'WRITE_OFF'

  const writeOffPreview =
    watchedType === ''
      ? null
      : computeWriteOff(watchedType, out, parseAmount(watchedSettlement) ?? 0)

  const onSubmit = (values: CloseFormValues) => {
    if (values.closure_type === '') return
    const type = values.closure_type
    const isWO = type === 'WRITE_OFF'

    const settlement = isWO ? '0' : values.final_settlement_amount.trim()
    const writeOff = computeWriteOff(type, out, parseAmount(settlement) ?? 0).toFixed(2)

    const payload: LoanCloseRequest = {
      closure_type: type,
      final_settlement_amount: settlement,
      amount_written_off: writeOff,
      charge_waived: values.charge_waived,
      closing_charges: isWO || values.charge_waived ? '0' : (values.closing_charges.trim() || '0'),
      waiver_reason: values.charge_waived ? values.waiver_reason.trim() : null,
      refund_due_to_customer: values.refund_due_to_customer.trim() || '0',
      refund_status: values.refund_status.trim() || null,
      noc_issued: values.noc_issued,
      noc_reference: values.noc_issued ? values.noc_reference.trim() : null,
      closure_date: values.closure_date ? values.closure_date.format('YYYY-MM-DD') : undefined,
      closure_remarks: values.closure_remarks.trim() || null,
    }

    close.mutate(payload, { onSuccess: () => onDone() })
  }

  const submitError = close.isError ? mapCloseError(close.error) : null

  return (
    <>
      <DialogContent dividers>
        <Box component="form" id="close-loan-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2.5}>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 'var(--radius-sm)',
                bgcolor: 'var(--surface-alt)',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Outstanding balance
              </Typography>
              <Typography variant="h3">{fmtINR(out)}</Typography>
            </Box>

            <Controller
              control={control}
              name="closure_type"
              render={({ field, fieldState }) => (
                <Input
                  select
                  id="closure_type"
                  label="Closure type"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                >
                  {availableTypes.map((t) => (
                    <MenuItem key={t} value={t}>
                      {CLOSURE_TYPE_LABELS[t]}
                    </MenuItem>
                  ))}
                </Input>
              )}
            />

            {!isWriteOff && (
              <Input
                id="final_settlement_amount"
                label="Final settlement amount"
                required
                inputMode="decimal"
                {...register('final_settlement_amount')}
                error={errors.final_settlement_amount?.message}
              />
            )}

            {writeOffPreview !== null && writeOffPreview > 0 && (
              <ErrorBanner
                severity={isWriteOff ? 'warning' : 'info'}
                variant="outlined"
                message={`Amount to be written off: ${fmtINR(writeOffPreview)}${
                  isWriteOff ? '. This loan will move to BAD_DEBT.' : ''
                }`}
              />
            )}

            <Divider />

            {!isWriteOff && (
              <>
                <Controller
                  control={control}
                  name="charge_waived"
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />
                      }
                      label="Waive closing charges"
                    />
                  )}
                />
                {!chargeWaived ? (
                  <Input
                    id="closing_charges"
                    label="Closing charges"
                    inputMode="decimal"
                    placeholder="0"
                    {...register('closing_charges')}
                    error={errors.closing_charges?.message}
                  />
                ) : (
                  <Input
                    id="waiver_reason"
                    label="Waiver reason"
                    required
                    multiline
                    minRows={2}
                    maxRows={5}
                    {...register('waiver_reason')}
                    error={errors.waiver_reason?.message}
                  />
                )}
              </>
            )}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2.5,
              }}
            >
              <Input
                id="refund_due_to_customer"
                label="Refund due to customer"
                inputMode="decimal"
                placeholder="0"
                {...register('refund_due_to_customer')}
                error={errors.refund_due_to_customer?.message}
              />
              <Input
                id="refund_status"
                label="Refund status"
                placeholder="e.g. Pending, Paid"
                {...register('refund_status')}
                error={errors.refund_status?.message}
              />
            </Box>

            <Controller
              control={control}
              name="noc_issued"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                  label="NOC issued"
                />
              )}
            />
            {nocIssued && (
              <Input
                id="noc_reference"
                label="NOC reference"
                required
                {...register('noc_reference')}
                error={errors.noc_reference?.message}
              />
            )}

            <Controller
              control={control}
              name="closure_date"
              render={({ field, fieldState }) => (
                <Box>
                  <FieldLabel htmlFor="closure_date">Closure date</FieldLabel>
                  <DatePicker
                    value={field.value}
                    onChange={(v) => field.onChange(v)}
                    format="DD MMM YYYY"
                    maxDate={dayjs()}
                    slotProps={{
                      textField: {
                        id: 'closure_date',
                        size: 'small',
                        fullWidth: true,
                        error: !!fieldState.error,
                      },
                    }}
                  />
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

            <Input
              id="closure_remarks"
              label="Remarks"
              multiline
              minRows={2}
              maxRows={6}
              placeholder="Optional notes about this closure"
              {...register('closure_remarks')}
              error={errors.closure_remarks?.message}
            />

            {submitError && <ErrorBanner message={submitError} />}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Btn variant="ghost" onClick={onCancel} disabled={close.isPending}>
          Cancel
        </Btn>
        <Btn type="submit" form="close-loan-form" variant="primary" loading={close.isPending}>
          Close loan
        </Btn>
      </DialogActions>
    </>
  )
}
