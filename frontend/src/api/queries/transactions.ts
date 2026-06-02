import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type {
  PaymentMethod,
  PunctualityStatus,
  TransactionStatus,
  TransactionType,
} from '@/schemas/enums'

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

export interface TransactionResponse {
  id: string
  loan_id: string
  amount: string
  payment_mode: PaymentMethod
  notes: string | null
  status: TransactionStatus
  transaction_type: TransactionType
  collected_by_id: string | null
  is_deleted: boolean
  created_by_id: string | null
  updated_by_id: string | null
  idempotency_key: string | null
  effective_payment_date: string
  punctuality_status: PunctualityStatus
  due_cycle_id: string | null
  created_at: string
  updated_at: string
}

export interface TransactionListResponse {
  total: number
  page: number
  page_size: number
  total_collected: string
  results: TransactionResponse[]
}

export const transactionKeys = {
  all: ['transactions'] as const,
  summary: (loanId: string) => [...transactionKeys.all, 'summary', loanId] as const,
  byLoan: (loanId: string) => [...transactionKeys.all, 'byLoan', loanId] as const,
}

export function useLoanTransactions(loanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: transactionKeys.byLoan(loanId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<TransactionListResponse>('/transactions/', {
        params: { loan_id: loanId, page_size: 100 },
      })
      return data
    },
    enabled: !!loanId && enabled,
  })
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
