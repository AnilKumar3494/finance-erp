import { useState } from 'react'
import Stack from '@mui/material/Stack'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanTransactions, useLoanSummary } from '@/api/queries/transactions'
import { Btn } from '@/components/primitives'
import { printLoanStatement } from '../loanStatement'
import { useTransactionFocus } from '../txnFocus'
import { CollapsibleCard } from './CollapsibleCard'
import { DueCyclesTab } from './DueCyclesTab'
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

  return (
    <>
      <CollapsibleCard title="Due cycles" action={<PrintStatementButton loan={loan} />}>
        <DueCyclesTab loan={loan} />
      </CollapsibleCard>
      <CollapsibleCard title="Transactions" openSignal={txnOpenSignal}>
        <TransactionsTab loan={loan} />
      </CollapsibleCard>
    </>
  )
}

function PrintStatementButton({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)
  const transactions = useLoanTransactions(loan.id)
  const summary = useLoanSummary(loan.id)

  const loading = cycles.isLoading || transactions.isLoading || summary.isLoading

  const onPrint = () =>
    printLoanStatement({
      loan,
      cycles: cycles.data?.results ?? [],
      transactions: transactions.data?.results ?? [],
      summary: summary.data,
    })

  return (
    <Stack sx={{ flexShrink: 0 }}>
      <Btn variant="ghost" size="sm" startIcon={<PrintIcon />} onClick={onPrint} disabled={loading}>
        Statement
      </Btn>
    </Stack>
  )
}
