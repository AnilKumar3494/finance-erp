import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs, { type Dayjs } from 'dayjs'
import { z } from 'zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import { useCreateTransaction, type TransactionCreate } from '@/api/queries/transactions'
import { useDueCycles } from '@/api/queries/dueCycles'
import { Btn, ErrorBanner, FieldLabel, Input } from '@/components/primitives'
import { PaymentMethod } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'

function mapErr(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 400) return detail ?? 'This payment could not be recorded. Check the amount and try again.'
    if (status === 403) return detail ?? 'You do not have permission to record a payment for this loan.'
    if (status === 404) return detail ?? 'Loan not found.'
    if (status === 409) return detail ?? 'This payment conflicts with the loan’s current state.'
    if (status === 422) return detail ?? 'Please check the details and try again.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong recording this payment. Please try again.'
}

interface FormValues {
  amount: string
  payment_mode: PaymentMethod
  effective_payment_date: Dayjs | null
  due_cycle_id: string
  notes: string
}

const Schema = z.object({
  amount: z.string().refine((s) => {
    const n = Number(s.trim())
    return s.trim() !== '' && Number.isFinite(n) && n > 0
  }, 'Enter a valid amount greater than 0'),
  payment_mode: PaymentMethod,
  effective_payment_date: z.custom<Dayjs | null>((v) => v === null || dayjs.isDayjs(v)),
  due_cycle_id: z
    .string()
    .min(1, 'Pick a cycle to apply this payment to'),
  notes: z.string(),
})

export function RecordPaymentDialog({
  loanId,
  open,
  onClose,
  defaultCycleId = '',
  defaultAmount = '',
}: {
  loanId: string
  open: boolean
  onClose: () => void
  defaultCycleId?: string
  defaultAmount?: string
}) {
  const create = useCreateTransaction(loanId)
  // Cycle dropdown for allocation — only fetched while the dialog is open.
  const cyclesQuery = useDueCycles(loanId, open)
  const cycles = cyclesQuery.data?.results ?? []

  // Cycle is required. If the caller didn't pass a default, pick a sensible
  // one ourselves so the user isn't dropped into an empty dropdown: prefer
  // the worst-unpaid (AWAITING_REVIEW with shortfall > 0), then the next
  // UPCOMING, then the first cycle. The seed is recomputed when the cycles
  // list arrives, so the dialog can open while cycles are still in flight.
  const seededCycleId = useMemo(() => {
    if (defaultCycleId) return defaultCycleId
    if (cycles.length === 0) return ''
    const worst = cycles.find(
      (c) =>
        (c.cycle_status === 'AWAITING_REVIEW' ||
          c.cycle_status === 'LATE_PAYMENT') &&
        Number(c.shortfall) > 0,
    )
    if (worst) return worst.id
    const upcoming = cycles.find((c) => c.cycle_status === 'UPCOMING')
    if (upcoming) return upcoming.id
    return cycles[0].id
  }, [defaultCycleId, cycles])

  const defaults = useMemo<FormValues>(
    () => ({
      amount: defaultAmount,
      payment_mode: 'CASH',
      effective_payment_date: dayjs(),
      due_cycle_id: seededCycleId,
      notes: '',
    }),
    [defaultAmount, seededCycleId],
  )

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: defaults })

  // Watch the live cycle pick so we can warn when the user has selected a
  // cycle that's already fully paid. The backend accepts overpayments (per
  // the existing "accept and flag" policy) so this is a soft warn, not a
  // submit block — admins occasionally do post a deliberate extra payment.
  const watchedCycleId = useWatch({ control, name: 'due_cycle_id' })
  const selectedCycle = useMemo(
    () => cycles.find((c) => c.id === watchedCycleId) ?? null,
    [watchedCycleId, cycles],
  )
  const selectedCycleIsPaid =
    selectedCycle != null && Number(selectedCycle.shortfall) <= 0

  // A late cycle with a later cycle on the loan has already had its dues spread
  // forward into those later EMIs. Recording against it won't reduce the
  // schedule — the admin should record against the next due cycle or reclassify
  // this one. Soft warn (the backend still accepts it).
  const lastCycleNumber = useMemo(
    () => cycles.reduce((max, c) => Math.max(max, c.cycle_number), 0),
    [cycles],
  )
  const selectedCycleSpreadForward =
    selectedCycle != null &&
    (selectedCycle.cycle_status === 'LATE_PAYMENT' ||
      selectedCycle.cycle_status === 'MISSED_CAPPED') &&
    selectedCycle.cycle_number < lastCycleNumber

  // Re-seed (amount/cycle) each time the dialog opens. Deps are intentionally
  // limited to `open`/`defaults`: the react-query mutation object (`create`)
  // gets a new identity on every status change, so including it here made the
  // effect re-run mid-submit and call create.reset(), which cancelled the
  // pending mutation before its POST ever fired. `create.reset`/`reset` are
  // stable, so calling them without listing them is safe.
  useEffect(() => {
    if (open) {
      create.reset()
      reset(defaults)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults])

  const close = () => {
    if (create.isPending) return
    onClose()
  }

  const onSubmit = (v: FormValues) => {
    const payload: TransactionCreate = {
      loan_id: loanId,
      amount: v.amount.trim(),
      payment_mode: v.payment_mode,
      // Cycle is required (zod-validated) so v.due_cycle_id is always a real
      // UUID by the time we get here.
      due_cycle_id: v.due_cycle_id,
      effective_payment_date: v.effective_payment_date
        ? v.effective_payment_date.format('YYYY-MM-DD')
        : undefined,
      notes: v.notes.trim() || undefined,
    }
    create.mutate(payload, { onSuccess: () => onClose() })
  }

  const error = create.isError ? mapErr(create.error) : null

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Record payment</DialogTitle>
      <Box component="form" id="record-payment-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogContent sx={{ pt: 0 }}>
          <Stack spacing={2.5}>
            {error && <ErrorBanner message={error} />}

            {selectedCycleSpreadForward && selectedCycle && (
              <Alert severity="warning" variant="outlined">
                Cycle #{selectedCycle.cycle_number} was classified late — its
                dues are already being recovered through the later EMIs.
                Recording here won't reduce the schedule. Record against the
                next due cycle instead, or reclassify cycle #
                {selectedCycle.cycle_number} once the customer settles it.
              </Alert>
            )}

            {selectedCycleIsPaid && !selectedCycleSpreadForward && selectedCycle && (
              <Alert severity="warning" variant="outlined">
                Cycle #{selectedCycle.cycle_number} has already received its
                full due ({fmtINR(Number(selectedCycle.total_received))}{' '}
                received of {fmtINR(Number(selectedCycle.total_due))}).
                Continue only if this is a legitimate extra payment.
              </Alert>
            )}

            <Input
              id="rp_amount"
              label="Amount"
              required
              autoFocus
              inputMode="decimal"
              placeholder="e.g. 6500"
              {...register('amount')}
              error={errors.amount?.message}
            />

            <Controller
              control={control}
              name="payment_mode"
              render={({ field }) => (
                <Input
                  select
                  id="rp_mode"
                  label="Payment mode"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {PaymentMethod.options.map((m) => (
                    <MenuItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </MenuItem>
                  ))}
                </Input>
              )}
            />

            <Controller
              control={control}
              name="effective_payment_date"
              render={({ field, fieldState }) => (
                <Box>
                  <FieldLabel htmlFor="rp_date">Payment date</FieldLabel>
                  <DatePicker
                    value={field.value}
                    onChange={(d) => field.onChange(d)}
                    format="DD MMM YYYY"
                    maxDate={dayjs()}
                    slotProps={{
                      textField: {
                        id: 'rp_date',
                        size: 'small',
                        fullWidth: true,
                        error: !!fieldState.error,
                      },
                    }}
                  />
                </Box>
              )}
            />

            <Controller
              control={control}
              name="due_cycle_id"
              render={({ field, fieldState }) => (
                <Input
                  select
                  id="rp_cycle"
                  label="Apply to cycle"
                  required
                  hint="Defaults to the next unpaid cycle — change if this payment belongs elsewhere."
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                >
                  {cycles.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      #{c.cycle_number} · {fmtDate(c.due_date)} · due {fmtINR(Number(c.total_due))}
                    </MenuItem>
                  ))}
                </Input>
              )}
            />

            <Input
              id="rp_notes"
              label="Notes"
              placeholder="Optional"
              multiline
              minRows={2}
              maxRows={5}
              {...register('notes')}
              error={errors.notes?.message}
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
          <Btn type="submit" form="record-payment-form" variant="primary" loading={create.isPending}>
            Record payment
          </Btn>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
