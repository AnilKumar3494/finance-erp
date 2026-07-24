import { useEffect, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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

import {
  type TransactionResponse,
  type TransactionUpdate,
} from '@/api/queries/transactions'
import { useDueCycles } from '@/api/queries/dueCycles'
import { Btn, ErrorBanner, FieldLabel, Input } from '@/components/primitives'
import { PaymentMethod } from '@/schemas/enums'
import { fmtDate, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'

// Edit any field of an existing transaction — cycle, amount, payment mode,
// effective date, notes. Submitting sends only the fields that actually
// changed (a diff against the original), so an "edit note only" call is one
// patched field on the server and audit log.
//
// The backend recomputes cycle.total_received on both the old and new cycle
// when allocation or amount changes on a SUCCESS row; for PENDING/FAILED
// edits the ledger doesn't move. Route-level access (PENDING/FAILED open to
// in-scope users, SUCCESS admin-only) is enforced server-side; the caller
// gates which actions to show in the UI.

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
  // A legacy NULL-cycle transaction shows here as an empty default. Saving
  // without picking a cycle is allowed — the form just won't include
  // due_cycle_id in the diff, so the existing (NULL) value stays. The dialog
  // strongly nudges admin to pick one via the warning banner when the
  // initial value is empty.
  due_cycle_id: z.string(),
  notes: z.string(),
})

export function EditTransactionDialog({
  txn,
  loanId,
  open,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  txn: TransactionResponse | null
  loanId: string
  open: boolean
  onClose: () => void
  onSubmit: (patch: TransactionUpdate) => void
  saving: boolean
  error: string | null
}) {
  // Cycles for the dropdown — same query DueCyclesTab uses, so cache hit.
  const cyclesQuery = useDueCycles(loanId, open)
  const cycles = cyclesQuery.data?.results ?? []

  const defaults = useMemo<FormValues>(
    () => ({
      amount: txn?.amount ?? '',
      payment_mode: (txn?.payment_mode as PaymentMethod) ?? 'CASH',
      effective_payment_date: txn?.effective_payment_date
        ? dayjs(txn.effective_payment_date)
        : null,
      due_cycle_id: txn?.due_cycle_id ?? '',
      notes: txn?.notes ?? '',
    }),
    [txn],
  )

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: defaults })

  // Re-seed each time the dialog opens. See the dialog-bug fix in commit
  // 5a6c7ae for why the mutation object is intentionally NOT in the deps.
  useEffect(() => {
    if (open) reset(defaults)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults])

  const close = () => {
    if (saving) return
    onClose()
  }

  const submit = (v: FormValues) => {
    if (!txn) return
    const patch: TransactionUpdate = {}

    const trimmedAmount = v.amount.trim()
    if (trimmedAmount !== txn.amount) patch.amount = trimmedAmount
    if (v.payment_mode !== txn.payment_mode) patch.payment_mode = v.payment_mode

    const newDate = v.effective_payment_date
      ? v.effective_payment_date.format('YYYY-MM-DD')
      : ''
    if (newDate && newDate !== txn.effective_payment_date) {
      patch.effective_payment_date = newDate
    }

    if (v.due_cycle_id !== (txn.due_cycle_id ?? '')) {
      // Empty string in the form means "no cycle picked" — only happens for
      // legacy NULL-cycle transactions before admin picks one. We send it
      // through only when the user actually selected a real cycle, to avoid
      // accidentally nulling out an existing allocation.
      if (v.due_cycle_id !== '') {
        patch.due_cycle_id = v.due_cycle_id
      }
    }

    const trimmedNotes = v.notes.trim()
    const existingNotes = txn.notes ?? ''
    if (trimmedNotes !== existingNotes) {
      patch.notes = trimmedNotes || null
    }

    onSubmit(patch)
  }

  const isSuccess = txn?.status === 'SUCCESS'
  const isUnallocated = txn?.due_cycle_id == null

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Edit Transaction</DialogTitle>
      <Box component="form" id="edit-txn-form" onSubmit={handleSubmit(submit)} noValidate>
        <DialogContent sx={{ pt: 0 }}>
          <Stack spacing={2.5}>
            {error && <ErrorBanner message={error} />}

            {isUnallocated && (
              <Alert severity="warning" variant="outlined">
                This transaction isn't allocated to any cycle. Pick one below
                so it gets counted in the cycle ledger.
              </Alert>
            )}

            {isSuccess && (
              <Alert severity="info" variant="outlined">
                Editing a confirmed transaction. Changes to cycle or amount
                recompute the affected cycles' totals.
              </Alert>
            )}

            <Input
              id="et_amount"
              label="Amount"
              required
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
                  id="et_mode"
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
                  <FieldLabel htmlFor="et_date">Payment date</FieldLabel>
                  <DatePicker
                    value={field.value}
                    onChange={(d) => field.onChange(d)}
                    format="DD MMM YYYY"
                    maxDate={dayjs()}
                    slotProps={{
                      textField: {
                        id: 'et_date',
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
                  id="et_cycle"
                  label="Apply to cycle"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                >
                  {/* Keep an empty option only when the txn is currently
                      unallocated — so the dropdown reflects the existing
                      NULL state instead of silently switching to cycle #1. */}
                  {isUnallocated && (
                    <MenuItem value="">— No cycle (unallocated)</MenuItem>
                  )}
                  {cycles.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      #{c.cycle_number} · {fmtDate(c.due_date)} · due {fmtINR(Number(c.total_due))}
                    </MenuItem>
                  ))}
                </Input>
              )}
            />

            <Input
              id="et_notes"
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
          <Btn variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Btn>
          <Btn type="submit" form="edit-txn-form" variant="primary" loading={saving}>
            Save changes
          </Btn>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
