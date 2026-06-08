import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { loanKeys } from '@/api/queries/loans'
import { dueCycleKeys } from '@/api/queries/dueCycles'
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

// --------------------------------------------------
// Mutations — mirror backend/app/schemas/transaction.py. amount is a string.
// A created transaction is PENDING; an admin then confirms (→ SUCCESS, which
// updates the cycle's received total and can move the loan to AWAITING_CLOSURE)
// or fails it. The collection POST carries an auto Idempotency-Key (client.ts).
// --------------------------------------------------

export interface TransactionCreate {
  loan_id: string
  amount: string
  payment_mode: PaymentMethod
  effective_payment_date?: string | null
  due_cycle_id?: string | null
  notes?: string | null
}

// Confirming/failing changes cycle totals and possibly loan status, so refresh
// the loan detail, schedule, and summary alongside the transaction list.
function invalidateLoanLedger(
  qc: ReturnType<typeof useQueryClient>,
  loanId: string,
) {
  qc.invalidateQueries({ queryKey: transactionKeys.byLoan(loanId) })
  qc.invalidateQueries({ queryKey: transactionKeys.summary(loanId) })
  // Covers both the per-loan schedule (byLoan) and the cross-loan worklist.
  qc.invalidateQueries({ queryKey: dueCycleKeys.all })
  qc.invalidateQueries({ queryKey: loanKeys.detail(loanId) })
}

export function useCreateTransaction(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: TransactionCreate) => {
      const { data } = await apiClient.post<TransactionResponse>('/transactions/', payload)
      return data
    },
    onSuccess: () => invalidateLoanLedger(qc, loanId),
  })
}

export function useConfirmTransaction(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: string) => {
      const { data } = await apiClient.post<TransactionResponse>(
        `/transactions/${transactionId}/confirm`,
      )
      return data
    },
    onSuccess: () => invalidateLoanLedger(qc, loanId),
  })
}

export function useFailTransaction(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: string) => {
      const { data } = await apiClient.post<TransactionResponse>(
        `/transactions/${transactionId}/fail`,
      )
      return data
    },
    onSuccess: () => invalidateLoanLedger(qc, loanId),
  })
}

// Edit a transaction's notes (admin). Backend accepts `{ notes }` only and
// rejects edits on a SUCCESS transaction — callers gate the action to
// PENDING/FAILED rows. A null clears the note.
export interface TransactionUpdate {
  notes: string | null
}

export function useUpdateTransaction(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { transactionId: string; payload: TransactionUpdate }) => {
      const { data } = await apiClient.patch<TransactionResponse>(
        `/transactions/${vars.transactionId}`,
        vars.payload,
      )
      return data
    },
    onSuccess: () => invalidateLoanLedger(qc, loanId),
  })
}

// Soft-delete a transaction (admin). Backend allows this for FAILED
// transactions only (400 otherwise); a wrong PENDING/SUCCESS txn must be
// failed first. Returns 204 — no body.
export function useDeleteTransaction(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (transactionId: string) => {
      await apiClient.delete(`/transactions/${transactionId}`)
    },
    onSuccess: () => invalidateLoanLedger(qc, loanId),
  })
}
