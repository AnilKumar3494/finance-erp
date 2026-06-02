import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'

// --------------------------------------------------
// Lean read surface for the Loans module: the outstanding-balance summary
// the closure form needs. Full transactions CRUD belongs to a dedicated
// Transactions module. Monetary fields arrive as strings.
// --------------------------------------------------

export interface LoanTransactionSummary {
  loan_id: string
  principal: string
  total_payable: string
  total_paid: string
  total_pending: string
  outstanding: string
  transaction_count: number
}

export const transactionKeys = {
  all: ['transactions'] as const,
  summary: (loanId: string) => [...transactionKeys.all, 'summary', loanId] as const,
}

export function useLoanSummary(loanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: transactionKeys.summary(loanId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<LoanTransactionSummary>(
        `/transactions/loan/${loanId}/summary`,
      )
      return data
    },
    enabled: !!loanId && enabled,
  })
}
