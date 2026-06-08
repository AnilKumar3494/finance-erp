import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanTransactions, useLoanSummary } from '@/api/queries/transactions'
import { Btn, Card } from '@/components/primitives'
import { printLoanStatement } from '../loanStatement'
import { DueCyclesTab } from './DueCyclesTab'
import { TransactionsTab } from './TransactionsTab'

export function LoanSubResources({ loan }: { loan: LoanResponse }) {
  const [tab, setTab] = useState(0)

  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: 1,
          borderColor: 'divider',
          px: { xs: 1, sm: 2 },
        }}
      >
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="Due cycles" />
          <Tab label="Transactions" />
        </Tabs>
        <PrintStatementButton loan={loan} />
      </Box>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {tab === 0 && <DueCyclesTab loan={loan} />}
        {tab === 1 && <TransactionsTab loan={loan} />}
      </Box>
    </Card>
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
