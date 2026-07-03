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
  pendingConfirmations: () => [...transactionKeys.all, 'pendingConfirmations'] as const,
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

// --------------------------------------------------
// Pending confirmations worklist — cross-loan PENDING transactions awaiting an
// admin's confirm/fail, enriched with loan + customer (+ cycle). Mirrors
// backend GET /transactions/pending-confirmations.
// --------------------------------------------------
export interface PendingConfirmationItem {
  id: string
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  customer_mobile: string
  amount: string
  payment_mode: PaymentMethod
  effective_payment_date: string
  collected_by_id: string | null
  created_at: string
  due_cycle_id: string | null
  cycle_number: number | null
  cycle_due_date: string | null
}

export interface PendingConfirmationListResponse {
  total: number
  page: number
  page_size: number
  total_pending_amount: string
  results: PendingConfirmationItem[]
}

export type PendingSortField =
  | 'amount'
  | 'effective_payment_date'
  | 'created_at'
  | 'customer_name'
  | 'loan'

export function usePendingConfirmations(
  page: number,
  pageSize = 20,
  sort?: { sort_by?: PendingSortField; sort_order?: 'asc' | 'desc' },
) {
  return useQuery({
    queryKey: [
      ...transactionKeys.pendingConfirmations(),
      page,
      pageSize,
      sort?.sort_by ?? null,
      sort?.sort_order ?? null,
    ] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<PendingConfirmationListResponse>(
        '/transactions/pending-confirmations',
        { params: { page, page_size: pageSize, ...sort } },
      )
      return data
    },
    placeholderData: (prev) => prev,
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
  // Required by the backend as of the cycle-required change — every payment
  // must land on a specific cycle to keep total_received in sync.
  due_cycle_id: string
  effective_payment_date?: string | null
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
  // The confirmations worklist (and its tab badge) lists PENDING rows.
  qc.invalidateQueries({ queryKey: transactionKeys.pendingConfirmations() })
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

// Worklist variants of confirm/fail: the loan id arrives per row rather than
// from a loan-scoped page, so it's part of the mutation variables.
export function useConfirmPendingTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { transactionId: string; loanId: string }) => {
      const { data } = await apiClient.post<TransactionResponse>(
        `/transactions/${vars.transactionId}/confirm`,
      )
      return data
    },
    onSuccess: (_data, vars) => invalidateLoanLedger(qc, vars.loanId),
  })
}

export function useFailPendingTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { transactionId: string; loanId: string }) => {
      const { data } = await apiClient.post<TransactionResponse>(
        `/transactions/${vars.transactionId}/fail`,
      )
      return data
    },
    onSuccess: (_data, vars) => invalidateLoanLedger(qc, vars.loanId),
  })
}

// Edit a transaction. All fields optional — only set fields are applied.
// PENDING/FAILED transactions are editable by any user in scope of the loan;
// SUCCESS transactions are editable by admins only (server-side gate). When
// `due_cycle_id` or `amount` changes on a SUCCESS row, the server recomputes
// total_received on both the old and new cycle.
// `notes: null` clears the existing note.
export interface TransactionUpdate {
  notes?: string | null
  due_cycle_id?: string | null
  amount?: string
  effective_payment_date?: string
  payment_mode?: PaymentMethod
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
