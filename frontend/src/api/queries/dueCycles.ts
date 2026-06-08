import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { transactionKeys } from '@/api/queries/transactions'
import type { CycleStatus, LoanStatus } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/due_cycle.py. Monetary fields are
// strings. classify/reclassify is an admin-only punctuality workflow.
// --------------------------------------------------

export interface DueCycleResponse {
  id: string
  loan_id: string
  cycle_number: number
  due_date: string
  base_emi: string
  addon_from_penalties: string
  total_due: string
  total_received: string
  penalty_amount: string
  cycle_status: CycleStatus
  classified_as_of_date: string | null
  classified_by_id: string | null
  classified_at: string | null
  classification_note: string | null
  shortfall: string
}

export interface DueCycleListResponse {
  loan_id: string
  total: number
  page: number
  page_size: number
  results: DueCycleResponse[]
}

export const dueCycleKeys = {
  all: ['dueCycles'] as const,
  byLoan: (loanId: string) => [...dueCycleKeys.all, 'byLoan', loanId] as const,
  worklist: (params: WorklistParams) =>
    [...dueCycleKeys.all, 'worklist', params] as const,
}

export function useDueCycles(loanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dueCycleKeys.byLoan(loanId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<DueCycleListResponse>(
        `/due-cycles/loan/${loanId}`,
      )
      return data
    },
    enabled: !!loanId && enabled,
  })
}

// --------------------------------------------------
// Collections worklist — cross-loan due cycles joined to loan + customer.
// Mirrors backend GET /due-cycles/ (DueCycleWorklistResponse). Money fields
// are strings. Access scoping is server-side (employees see their assignees).
// --------------------------------------------------

export interface DueCycleWorklistItem {
  id: string
  loan_id: string
  cycle_number: number
  due_date: string
  total_due: string
  total_received: string
  shortfall: string
  penalty_amount: string
  cycle_status: CycleStatus
  days_overdue: number
  loan_number: string
  loan_status: LoanStatus
  customer_id: string
  customer_name: string
  customer_mobile: string
  mandal_village: string | null
}

export interface DueCycleWorklistResponse {
  total: number
  page: number
  page_size: number
  results: DueCycleWorklistItem[]
}

export interface WorklistParams {
  status?: CycleStatus
  due_before?: string
  due_after?: string
  unpaid_only?: boolean
  search?: string
  page: number
  page_size?: number
}

export function useDueCycleWorklist(params: WorklistParams) {
  return useQuery({
    queryKey: dueCycleKeys.worklist(params),
    queryFn: async () => {
      const { data } = await apiClient.get<DueCycleWorklistResponse>('/due-cycles/', {
        params,
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

// --------------------------------------------------
// Classification (admin) — mirror backend CycleClassifyRequest. `classify` is
// for a cycle in AWAITING_REVIEW; `reclassify` overrides an already-classified
// cycle. Punctuality propagates to that cycle's transactions, so refresh both.
// --------------------------------------------------

export interface CycleClassifyRequest {
  cycle_status: CycleStatus
  // The backend REQUIRES this when cycle_status is LATE_PAYMENT.
  classified_as_of_date?: string | null
  classification_note?: string | null
}

// classify/reclassify return the cycle wrapped alongside any penalty event the
// (re)classification produced.
export interface CycleClassifyResult {
  cycle: DueCycleResponse
  penalty_event: unknown | null
}

export function useClassifyCycle(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { cycleId: string; payload: CycleClassifyRequest }) => {
      const { data } = await apiClient.post<CycleClassifyResult>(
        `/due-cycles/${vars.cycleId}/classify`,
        vars.payload,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dueCycleKeys.byLoan(loanId) })
      qc.invalidateQueries({ queryKey: transactionKeys.byLoan(loanId) })
    },
  })
}

export function useReclassifyCycle(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { cycleId: string; payload: CycleClassifyRequest }) => {
      const { data } = await apiClient.post<CycleClassifyResult>(
        `/due-cycles/${vars.cycleId}/reclassify`,
        vars.payload,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dueCycleKeys.byLoan(loanId) })
      qc.invalidateQueries({ queryKey: transactionKeys.byLoan(loanId) })
    },
  })
}
