import Stack from '@mui/material/Stack'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanTransactions, useLoanSummary } from '@/api/queries/transactions'
import { Btn } from '@/components/primitives'
import { printLoanStatement } from '../loanStatement'
import { CollapsibleCard } from './CollapsibleCard'
import { DueCyclesTab } from './DueCyclesTab'
import { TransactionsTab } from './TransactionsTab'

// Due cycles and transactions each live in their own collapsible section so the
// detail page stays scannable. The statement (which spans both) prints from the
// Due cycles header.
export function LoanSubResources({ loan }: { loan: LoanResponse }) {
  return (
    <>
      <CollapsibleCard title="Due cycles" action={<PrintStatementButton loan={loan} />}>
        <DueCyclesTab loan={loan} />
      </CollapsibleCard>
      <CollapsibleCard title="Transactions">
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
