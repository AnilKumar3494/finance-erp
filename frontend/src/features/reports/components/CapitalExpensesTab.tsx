import { useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import AddIcon from '@mui/icons-material/AddOutlined'

import {
  CASH_ENTRY_TYPE_LABELS,
  CASH_IN_TYPES,
  useCashEntries,
  useCreateCashEntry,
  useDeleteCashEntry,
  type CashEntry,
  type CashEntryType,
} from '@/api/queries/cashEntries'
import { serverMessage } from '@/api/errors'
import { Btn, Card, ErrorBanner, Input } from '@/components/primitives'
import { ClearDatesButton } from '@/components/filters/ClearDatesButton'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { fmtDate, fmtINR } from '@/lib/format'
import { onlyValidDate } from '@/lib/dateRange'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

const inr = (s: string) => fmtINR(Number(s))
const iso = (d: Dayjs) => d.format('YYYY-MM-DD')

const TYPE_OPTIONS: CashEntryType[] = ['EXPENSE', 'CAPITAL_IN', 'CAPITAL_OUT', 'OTHER_INCOME']

/**
 * Capital & Expenses — the non-loan cash ledger. Entries recorded here flow
 * straight into the Day / Multi-Day report position, turning it into a real
 * cash book (this is the iFinance Capitals/Expenses idea, collapsed into one
 * simple screen).
 */
export function CapitalExpensesTab() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().subtract(29, 'day'))
  const [to, setTo] = useState<Dayjs>(() => dayjs())
  const isDefault = from.isSame(dayjs().subtract(29, 'day'), 'day') && to.isSame(dayjs(), 'day')
  const resetWindow = () => {
    setFrom(dayjs().subtract(29, 'day'))
    setTo(dayjs())
  }
  const [typeFilter, setTypeFilter] = useState<CashEntryType | ''>('')
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CashEntry | null>(null)

  const rangeError = to.isBefore(from, 'day')
    ? 'The end date must be on or after the start date.'
    : null
  const query = useCashEntries(iso(from), iso(to), typeFilter, !rangeError)
  const report = query.data

  const deleteEntry = useDeleteCashEntry()

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
      >
        <Box sx={{ minWidth: 180 }}>
          <FieldLabel htmlFor="ce-from">From</FieldLabel>
          <DatePicker
            value={from}
            onChange={onlyValidDate(setFrom)}
            format="DD MMM YYYY"
            slotProps={{ textField: { id: 'ce-from', size: 'small', fullWidth: true } }}
          />
        </Box>
        <Box sx={{ minWidth: 180 }}>
          <FieldLabel htmlFor="ce-to">To</FieldLabel>
          <DatePicker
            value={to}
            onChange={onlyValidDate(setTo)}
            format="DD MMM YYYY"
            slotProps={{ textField: { id: 'ce-to', size: 'small', fullWidth: true } }}
          />
        </Box>
        {!isDefault && (
          <ClearDatesButton onClick={resetWindow} title="Reset to the default period" />
        )}
        <Box sx={{ minWidth: 170 }}>
          <Input
            select
            id="ce-type"
            label="Type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CashEntryType | '')}
            slotProps={{
              select: {
                displayEmpty: true,
                renderValue: (v) =>
                  v ? CASH_ENTRY_TYPE_LABELS[v as CashEntryType] : 'All types',
              },
            }}
          >
            <MenuItem value="">All types</MenuItem>
            {TYPE_OPTIONS.map((t) => (
              <MenuItem key={t} value={t}>
                {CASH_ENTRY_TYPE_LABELS[t]}
              </MenuItem>
            ))}
          </Input>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Btn variant="primary" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add entry
        </Btn>
      </Stack>

      {rangeError && <ErrorBanner message={rangeError} />}
      {deleteEntry.isError && (
        <ErrorBanner
          message={serverMessage(deleteEntry.error) ?? 'Could not delete this entry.'}
        />
      )}

      {!rangeError && (
        <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
          {report && (
            <>
              <Box sx={KPI_GRID_SX}>
                <KpiCard
                  label="Money in"
                  value={inr(report.total_in)}
                  hint={`Capital ${inr(report.capital_in)} · Income ${inr(report.other_income)}`}
                  accent="success.main"
                />
                <KpiCard
                  label="Money out"
                  value={inr(report.total_out)}
                  hint={`Expenses ${inr(report.expenses)} · Withdrawals ${inr(report.capital_out)}`}
                  accent="error.main"
                />
                <KpiCard
                  label="Net in period"
                  value={fmtINR(Number(report.total_in) - Number(report.total_out))}
                />
              </Box>

              {report.results.length === 0 ? (
                <Card>
                  <Typography variant="h3">No entries</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Nothing recorded in this window. Use “Add entry” to record capital,
                    income, or an expense — it flows into the Day Report automatically.
                  </Typography>
                </Card>
              ) : (
                <Card sx={{ p: 0, overflow: 'hidden' }}>
                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table
                      size="small"
                      sx={{ minWidth: 720, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">In</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Out</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.results.map((e) => {
                          const isIn = CASH_IN_TYPES.includes(e.entry_type)
                          return (
                            <TableRow key={e.id} hover>
                              <TableCell>{fmtDate(e.entry_date)}</TableCell>
                              <TableCell>{CASH_ENTRY_TYPE_LABELS[e.entry_type]}</TableCell>
                              <TableCell>{e.category ?? '—'}</TableCell>
                              <TableCell sx={{ maxWidth: 280 }}>
                                <Typography
                                  variant="body2"
                                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={e.notes ?? undefined}
                                >
                                  {e.notes ?? '—'}
                                </Typography>
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>
                                {isIn ? inr(e.amount) : '—'}
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                                {!isIn ? inr(e.amount) : '—'}
                              </TableCell>
                              <TableCell align="right">
                                <Btn
                                  variant="ghost"
                                  size="sm"
                                  disabled={deleteEntry.isPending}
                                  onClick={() => setConfirmDelete(e)}
                                >
                                  Delete
                                </Btn>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              )}
            </>
          )}
        </AsyncSection>
      )}

      <AddEntryDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this entry?</DialogTitle>
        <DialogContent>
          {confirmDelete && (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {CASH_ENTRY_TYPE_LABELS[confirmDelete.entry_type]} ·{' '}
                {inr(confirmDelete.amount)} on {fmtDate(confirmDelete.entry_date)}
                {confirmDelete.category ? ` · ${confirmDelete.category}` : ''}. The Day
                Report position will update to match.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Btn>
                <Btn
                  variant="danger"
                  disabled={deleteEntry.isPending}
                  onClick={() =>
                    deleteEntry.mutate(confirmDelete.id, {
                      onSettled: () => setConfirmDelete(null),
                    })
                  }
                >
                  Delete entry
                </Btn>
              </Stack>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

function AddEntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCashEntry()
  const [entryType, setEntryType] = useState<CashEntryType>('EXPENSE')
  const [entryDate, setEntryDate] = useState<Dayjs>(() => dayjs())
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')

  const amountNum = Number(amount)
  const amountError =
    amount.trim() !== '' && (!Number.isFinite(amountNum) || amountNum <= 0)
      ? 'Enter an amount greater than zero.'
      : undefined
  const canSubmit = amount.trim() !== '' && !amountError && !create.isPending

  const reset = () => {
    setEntryType('EXPENSE')
    setEntryDate(dayjs())
    setAmount('')
    setCategory('')
    setNotes('')
    create.reset()
  }

  const submit = () =>
    create.mutate(
      {
        entry_type: entryType,
        entry_date: iso(entryDate),
        amount: amount.trim(),
        category: category.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          reset()
          onClose()
        },
      },
    )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add Capital / Expense Entry</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {create.isError && (
            <ErrorBanner
              message={serverMessage(create.error) ?? 'Could not save this entry.'}
            />
          )}
          <Input
            select
            id="ce-add-type"
            label="Type"
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as CashEntryType)}
          >
            {TYPE_OPTIONS.map((t) => (
              <MenuItem key={t} value={t}>
                {CASH_ENTRY_TYPE_LABELS[t]}
              </MenuItem>
            ))}
          </Input>
          <Box>
            <FieldLabel htmlFor="ce-add-date">Date</FieldLabel>
            <DatePicker
              value={entryDate}
              onChange={onlyValidDate(setEntryDate)}
              format="DD MMM YYYY"
              maxDate={dayjs()}
              slotProps={{ textField: { id: 'ce-add-date', size: 'small', fullWidth: true } }}
            />
          </Box>
          <Input
            id="ce-add-amount"
            label="Amount (₹)"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amountError}
            inputMode="decimal"
            autoComplete="off"
          />
          <Input
            id="ce-add-category"
            label="Category"
            hint="e.g. Office rent, Partner capital, Salaries"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            autoComplete="off"
          />
          <Input
            id="ce-add-notes"
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" disabled={!canSubmit} onClick={submit}>
              {create.isPending ? 'Saving…' : 'Save entry'}
            </Btn>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
