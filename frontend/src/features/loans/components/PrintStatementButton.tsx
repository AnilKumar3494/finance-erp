import Stack from '@mui/material/Stack'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanTransactions, useLoanSummary } from '@/api/queries/transactions'
import { useCustomer } from '@/api/queries/customers'
import { useVehicle } from '@/api/queries/vehicles'
import { useLoanPersonnel } from '@/api/queries/personnel'
import { Btn } from '@/components/primitives'
import { printLoanStatement } from '../loanStatement'

// Prints the customer statement (the iFinance-style file summary) for a loan.
// The statement needs the full customer address, the guarantor, and the
// vehicle's chassis/engine — none of which ride on the loan's thin nested
// objects — so this fetches them alongside the cycles/transactions/summary.
//
// Used both in the detail header (next to the status chip) and wherever else a
// statement is offered; the queries are cached, so mounting it twice is cheap.
export function PrintStatementButton({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)
  const transactions = useLoanTransactions(loan.id)
  const summary = useLoanSummary(loan.id)
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
      <Btn
        variant="primary"
        size="sm"
        startIcon={<PrintIcon />}
        onClick={onPrint}
        disabled={loading}
        // Match the medium status chips it sits beside: same 32px pill, and the
        // same 220px column width on desktop so it aligns flush under them.
        // 220 is what the label needs on one line — the chips follow it.
        sx={{
          height: 32,
          borderRadius: '16px',
          minWidth: { xs: 'auto', sm: 220 },
          whiteSpace: 'nowrap',
          px: 2,
          fontSize: 13,
          fontWeight: 500,
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        }}
      >
        Share to Customer PDF
      </Btn>
    </Stack>
  )
}
