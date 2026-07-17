import { useState } from 'react'
import Stack from '@mui/material/Stack'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanTransactions, useLoanSummary } from '@/api/queries/transactions'
import { useCustomer } from '@/api/queries/customers'
import { useVehicle } from '@/api/queries/vehicles'
import { useLoanPersonnel } from '@/api/queries/personnel'
import { Btn } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { printLoanStatement } from '../loanStatement'
import { useTransactionFocus } from '../txnFocus'
import { annualIrrPct, loanCashflow } from '../irrMath'
import { baseEmisOf, loanIrrTerms } from '../loanIrrTerms'
import { CollapsibleCard } from './CollapsibleCard'
import { DueCyclesTab } from './DueCyclesTab'
import { LoanIrrCard } from './LoanIrrCard'
import { TransactionsTab } from './TransactionsTab'

// Due cycles and transactions each live in their own collapsible section so the
// detail page stays scannable. The statement (which spans both) prints from the
// Due cycles header.
//
// When a cycle's "Pending confirmation" chip is clicked, DueCyclesTab fires a
// focusTransaction event. TransactionsTab listens too and scrolls/highlights,
// but its CollapsibleCard wrapper here would normally be collapsed — so we
// bump openSignal to force it open before TransactionsTab's effect can run.
export function LoanSubResources({ loan }: { loan: LoanResponse }) {
  const [txnOpenSignal, setTxnOpenSignal] = useState<number | undefined>(undefined)
  useTransactionFocus(() => {
    setTxnOpenSignal((n) => (n ?? 0) + 1)
  })

  // Quick-info summaries shown on the collapsed headers.
  const cycles = useDueCycles(loan.id)
  const summary = useLoanSummary(loan.id)
  const cycleCount = cycles.data?.total
  const dueSubtitle =
    cycleCount && cycleCount > 0
      ? `${cycleCount} EMI cycles · ${fmtINR(Number(summary.data?.outstanding ?? 0))} outstanding`
      : undefined
  const txnSubtitle =
    summary.data && summary.data.transaction_count > 0
      ? `${summary.data.transaction_count} payments · ${fmtINR(Number(summary.data.total_paid))} collected`
      : undefined

  // Preview the flat-vs-true comparison on the collapsed header — it is the
  // whole point of the card, and reuses the cycles already fetched above.
  const irrTerms = loanIrrTerms(loan, baseEmisOf(cycles.data?.results ?? []))
  const irrPct = irrTerms ? annualIrrPct(loanCashflow(irrTerms)) : null
  const flatPct = Number(loan.interest_rate ?? NaN)
  const irrSubtitle =
    irrPct !== null && Number.isFinite(flatPct)
      ? `${flatPct.toFixed(2)}% flat · ${irrPct.toFixed(2)}% true rate`
      : undefined

  return (
    <>
      <CollapsibleCard
        title="Due cycles"
        subtitle={dueSubtitle}
        action={<PrintStatementButton loan={loan} />}
      >
        <DueCyclesTab loan={loan} />
      </CollapsibleCard>
      <CollapsibleCard title="Transactions" subtitle={txnSubtitle} openSignal={txnOpenSignal}>
        <TransactionsTab loan={loan} />
      </CollapsibleCard>
      <CollapsibleCard title="Interest" subtitle={irrSubtitle}>
        <LoanIrrCard loan={loan} />
      </CollapsibleCard>
    </>
  )
}

function PrintStatementButton({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)
  const transactions = useLoanTransactions(loan.id)
  const summary = useLoanSummary(loan.id)
  // The customer statement mirrors the old iFinance file summary, which needs
  // the full customer address, the guarantor, and the vehicle's chassis/engine
  // — none of which ride on the loan's thin nested objects, so fetch them here.
  const customer = useCustomer(loan.customer_id)
  const vehicle = useVehicle(loan.vehicle_id ?? undefined)
  const personnel = useLoanPersonnel(loan.id)

  const loading =
    cycles.isLoading || transactions.isLoading || summary.isLoading || personnel.isLoading

  const onPrint = () =>
    printLoanStatement({
      loan,
      cycles: cycles.data?.results ?? [],
      transactions: transactions.data?.results ?? [],
      summary: summary.data,
      customer: customer.data,
      vehicle: vehicle.data,
      personnel: personnel.data?.results ?? [],
    })

  return (
    <Stack sx={{ flexShrink: 0 }}>
      <Btn variant="ghost" size="sm" startIcon={<PrintIcon />} onClick={onPrint} disabled={loading}>
        Statement
      </Btn>
    </Stack>
  )
}
