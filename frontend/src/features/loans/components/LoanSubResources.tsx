import { useState } from 'react'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'

import type { LoanResponse } from '@/api/queries/loans'
import { Card } from '@/components/primitives'
import { DueCyclesTab } from './DueCyclesTab'
import { TransactionsTab } from './TransactionsTab'
import { PersonnelTab } from './PersonnelTab'

export function LoanSubResources({ loan }: { loan: LoanResponse }) {
  const [tab, setTab] = useState(0)

  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 1, sm: 2 } }}
      >
        <Tab label="Due cycles" />
        <Tab label="Transactions" />
        <Tab label="Personnel" />
      </Tabs>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {tab === 0 && <DueCyclesTab loanId={loan.id} />}
        {tab === 1 && <TransactionsTab loanId={loan.id} />}
        {tab === 2 && <PersonnelTab loanId={loan.id} />}
      </Box>
    </Card>
  )
}
