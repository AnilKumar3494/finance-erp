import { useEffect, useMemo, useState } from 'react'
import { AxiosError } from 'axios'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'
import AddIcon from '@mui/icons-material/AddOutlined'

import { useLoan, type LoanResponse } from '@/api/queries/loans'
import { useDueCycles, type DueCycleResponse } from '@/api/queries/dueCycles'
import {
  useLoanTransactions,
  useLoanSummary,
  type LoanTransactionSummary,
} from '@/api/queries/transactions'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { LoanStatusChip } from '../components/LoanStatusChip'
import { EmiDueChip } from '../components/EmiDueChip'
import { DueCyclesTab } from '../components/DueCyclesTab'
import { TransactionsTab } from '../components/TransactionsTab'
import { RecordPaymentDialog } from '../components/RecordPaymentDialog'
import { deriveNetDue, type CycleNetDue } from '../cycleNetDue'

// Read search params (`?action=record&cycleId=`) from the cockpit route. Using
// getRouteApi instead of importing the Route object avoids a circular import
// with the route file.
const routeApi = getRouteApi('/_authed/finances/$loanId/collections')

function mapDetailError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 404) return 'Finance not found.'
    if (status === 403) return 'You do not have access to this finance.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this finance.'
}

export function LoanCollectionsPage({ loanId }: { loanId: string }) {
  const navigate = useNavigate()
  const query = useLoan(loanId)

  return (
    <Box sx={{ width: { xs: '100%', md: '90%' }, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 2 }}>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/transactions', search: { view: 'due', page: 1 } })}
        >
          Collections
        </Btn>
      </Stack>

      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message={mapDetailError(query.error)} />
      ) : query.data ? (
        <CockpitBody loan={query.data} />
      ) : null}
    </Box>
  )
}

function CockpitBody({ loan }: { loan: LoanResponse }) {
  const navigate = useNavigate()
  const search = routeApi.useSearch()
  const summaryQuery = useLoanSummary(loan.id)
  const txnsQuery = useLoanTransactions(loan.id)
  const cyclesQuery = useDueCycles(loan.id, loan.status !== 'DRAFT')

  const payable = loan.status === 'ACTIVE' || loan.status === 'AWAITING_CLOSURE'
  const cycles = cyclesQuery.data?.results ?? []
  const txns = txnsQuery.data?.results ?? []

  // Net-due waterfall — same logic the schedule tab uses, so the header agrees
  // with the table. Pool is the loan's total paid (Σ SUCCESS).
  const netDueByCycleId = useMemo(
    () => deriveNetDue(cycles, Number(summaryQuery.data?.total_paid ?? 0)),
    [cycles, summaryQuery.data],
  )

  // The cycle to act on first: the lowest-numbered cycle that still genuinely
  // owes money (net of carried-forward credit, and skipping late cycles whose
  // deficit was already rolled into later EMIs).
  const focusCycle = useMemo(
    () =>
      cycles
        .filter((c) => (netDueByCycleId.get(c.id)?.netDue ?? 0) > 0)
        .sort((a, b) => a.cycle_number - b.cycle_number)[0] ?? null,
    [cycles, netDueByCycleId],
  )
  const focusNet = focusCycle ? netDueByCycleId.get(focusCycle.id) : undefined

  const pendingTxns = txns.filter((t) => t.status === 'PENDING')
  const pendingTotal = pendingTxns.reduce((sum, t) => sum + Number(t.amount), 0)

  const [recordOpen, setRecordOpen] = useState(false)
  const [seedCycleId, setSeedCycleId] = useState('')
  const [seedAmount, setSeedAmount] = useState('')

  // Auto-open dialog when arriving with `?action=record`. Pre-seed from the
  // cycle in the URL (if any) or fall back to the worst-unpaid / next-EMI
  // heuristic. Strip the search params after opening so reload doesn't reopen.
  useEffect(() => {
    if (search.action !== 'record' || !payable) return
    const fromUrl = search.cycleId
      ? cycles.find((c) => c.id === search.cycleId) ?? null
      : null
    const target = fromUrl ?? focusCycle
    const net = target ? netDueByCycleId.get(target.id)?.netDue ?? 0 : 0
    setSeedCycleId(target?.id ?? '')
    setSeedAmount(net > 0 ? net.toFixed(2) : '')
    setRecordOpen(true)
    navigate({ to: '.', search: {}, replace: true })
    // Re-run only when the URL flips to action=record. Cycles being loaded
    // later still seeds correctly because the dialog itself fetches cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.action, search.cycleId])

  const onHeaderRecord = () => {
    const target = focusCycle
    const net = target ? netDueByCycleId.get(target.id)?.netDue ?? 0 : 0
    setSeedCycleId(target?.id ?? '')
    setSeedAmount(net > 0 ? net.toFixed(2) : '')
    setRecordOpen(true)
  }

  return (
    <Stack spacing={3}>
      <HeaderCard
        loan={loan}
        summary={summaryQuery.data}
        focusCycle={focusCycle}
        focusNet={focusNet}
        pendingCount={pendingTxns.length}
        pendingTotal={pendingTotal}
        payable={payable}
        onRecord={onHeaderRecord}
      />

      {pendingTxns.length > 0 && (
        <Alert severity="warning" variant="outlined">
          {pendingTxns.length === 1
            ? `1 transaction awaiting confirmation — ${fmtINR(pendingTotal)}`
            : `${pendingTxns.length} transactions awaiting confirmation — total ${fmtINR(pendingTotal)}`}
        </Alert>
      )}

      <Card>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Transactions
        </Typography>
        <TransactionsTab loan={loan} />
      </Card>

      <Card>
        <Typography variant="h3" sx={{ mb: 2 }}>
          EMI schedule
        </Typography>
        <DueCyclesTab loan={loan} />
      </Card>

      <RecordPaymentDialog
        loanId={loan.id}
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        defaultCycleId={seedCycleId}
        defaultAmount={seedAmount}
      />
    </Stack>
  )
}

// --------------------------------------------------
// Header — loan identity + money-at-a-glance + Record entry point
// --------------------------------------------------

interface HeaderCardProps {
  loan: LoanResponse
  summary: LoanTransactionSummary | undefined
  focusCycle: DueCycleResponse | null
  focusNet: CycleNetDue | undefined
  pendingCount: number
  pendingTotal: number
  payable: boolean
  onRecord: () => void
}

function HeaderCard({
  loan,
  summary,
  focusCycle,
  focusNet,
  pendingCount,
  pendingTotal,
  payable,
  onRecord,
}: HeaderCardProps) {
  return (
    <Card>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1.5, sm: 2 }}
          sx={{
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Collections workspace
            </Typography>
            <Typography
              variant="h1"
              sx={{ fontSize: { xs: 20, sm: 24 }, fontFamily: 'var(--font-mono)' }}
            >
              {loan.loan_number}
            </Typography>
            {loan.customer?.full_name && (
              <Box sx={{ mt: 0.75 }}>
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Name:{' '}
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {loan.customer.full_name}
                  </Box>
                </Typography>
                {loan.customer.mobile_number && (
                  <Typography variant="body2">
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Phone Number:{' '}
                    </Box>
                    <Box
                      component="span"
                      sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}
                    >
                      {loan.customer.mobile_number}
                    </Box>
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          <Stack
            direction={{ xs: 'row', sm: 'column' }}
            spacing={{ xs: 1, sm: 0.5 }}
            sx={{
              flexShrink: 0,
              flexWrap: 'wrap',
              rowGap: { xs: 1, sm: 0.5 },
              alignItems: { xs: 'flex-start', sm: 'flex-end' },
              '& .MuiChip-root': {
                minWidth: { xs: 'auto', sm: 188 },
                justifyContent: 'center',
              },
            }}
          >
            <LoanStatusChip status={loan.status} size="medium" />
            <EmiDueChip status={loan.emi_due_status} size="medium" />
          </Stack>
        </Stack>

        <Divider />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
            gap: { xs: 1.5, sm: 2.5 },
          }}
        >
          <HeaderStat
            label="Outstanding"
            value={summary ? fmtINR(Number(summary.outstanding)) : '—'}
          />
          <HeaderStat
            label="Total paid"
            value={summary ? fmtINR(Number(summary.total_paid)) : '—'}
          />
          <HeaderStat
            label={focusCycle ? `Cycle #${focusCycle.cycle_number} net due` : 'Net due'}
            value={focusCycle && focusNet ? fmtINR(focusNet.netDue) : '—'}
            hint={focusCycle ? `due ${fmtDate(focusCycle.due_date)}` : undefined}
            tone={focusNet && focusNet.netDue > 0 ? 'warning' : undefined}
          />
          <HeaderStat
            label="Pending confirmations"
            value={pendingCount > 0 ? `${pendingCount}` : '—'}
            hint={pendingCount > 0 ? fmtINR(pendingTotal) : undefined}
            tone={pendingCount > 0 ? 'warning' : undefined}
          />
        </Box>

        {focusCycle && (
          <>
            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">
                Focus cycle — #{focusCycle.cycle_number} · due {fmtDate(focusCycle.due_date)}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                  gap: { xs: 1.5, sm: 2.5 },
                  mt: 0.5,
                }}
              >
                <HeaderStat label="Scheduled due" value={fmtINR(Number(focusCycle.total_due))} />
                <HeaderStat label="Received" value={fmtINR(Number(focusCycle.total_received))} />
                <HeaderStat
                  label="Penalty"
                  value={
                    Number(focusCycle.penalty_amount) > 0
                      ? fmtINR(Number(focusCycle.penalty_amount))
                      : '—'
                  }
                />
              </Box>
            </Box>
          </>
        )}

        {payable && (
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
            <Btn
              variant="primary"
              size="md"
              startIcon={<AddIcon />}
              onClick={onRecord}
            >
              Record payment
            </Btn>
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

function HeaderStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warning'
}) {
  const color = tone === 'warning' ? 'warning.main' : undefined
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 16, sm: 18 }, color }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  )
}
