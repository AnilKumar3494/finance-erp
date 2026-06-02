import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import type { LoanStatus, PaymentMethod, UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/loan.py exactly.
// Money (Numeric(15,2)) and rate (Numeric(5,2)) fields are serialized as
// JSON strings by the backend to preserve Decimal precision. Keep them as
// `string` end-to-end; parse only at display/validation boundaries.
// --------------------------------------------------

// Nested objects are populated only when the request passes `?include=`.
export interface LoanCustomerNested {
  id: string
  full_name: string
  mobile_number: string
  assigned_employee_id: string | null
}

export interface LoanVehicleNested {
  id: string
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
}

export interface LoanUserNested {
  id: string
  username: string
  full_name: string | null
  role: UserRole
}

export interface LoanResponse {
  id: string
  customer_id: string
  vehicle_id: string | null
  loan_number: string
  principal: string
  interest_rate: string
  tenure: number
  down_payment: string
  processing_fee: string
  documentation_fee: string
  status: LoanStatus
  is_deleted: boolean
  created_by_id: string | null
  updated_by_id: string | null
  created_at: string
  updated_at: string

  // Lifecycle — populated only after approval.
  penalty_rate: string | null
  approval_date: string | null
  due_day_of_month: number | null

  // Computed by the backend on every response.
  monthly_interest: string | null
  total_payable: string | null
  net_loan_principal: string | null
  net_disbursed_amount: string | null

  // Populated only when the request includes them.
  customer?: LoanCustomerNested | null
  vehicle?: LoanVehicleNested | null
  created_by?: LoanUserNested | null
  updated_by?: LoanUserNested | null
}

export interface LoanListResponse {
  total: number
  page: number
  page_size: number
  results: LoanResponse[]
}

export interface LoanCreate {
  customer_id: string
  vehicle_id?: string | null
  principal: string
  interest_rate: string
  tenure: number
  down_payment?: string
  processing_fee?: string
  documentation_fee?: string
  // Required by the backend only when down_payment > 0.
  down_payment_mode?: PaymentMethod | null
  penalty_rate?: string | null
}

// Partial update — only DRAFT/ACTIVE loans are editable; the backend uses
// model_dump(exclude_unset=True), so omit unchanged fields. `status` is
// intentionally NOT exposed here: lifecycle transitions go through the
// dedicated approve/close/bad-debt routes, never a generic PATCH.
export interface LoanUpdate {
  vehicle_id?: string | null
  principal?: string
  interest_rate?: string
  tenure?: number
  down_payment?: string
  processing_fee?: string
  documentation_fee?: string
  penalty_rate?: string
}

export interface LoanListParams {
  page: number
  page_size?: number
  customer_id?: string
  vehicle_id?: string
  status?: LoanStatus
  include?: string
}

// --------------------------------------------------
// Query keys
// --------------------------------------------------

export const loanKeys = {
  all: ['loans'] as const,
  lists: () => [...loanKeys.all, 'list'] as const,
  list: (params: LoanListParams) => [...loanKeys.lists(), params] as const,
  details: () => [...loanKeys.all, 'detail'] as const,
  detail: (id: string) => [...loanKeys.details(), id] as const,
  byCustomer: (customerId: string) => [...loanKeys.all, 'byCustomer', customerId] as const,
}

// Detail always pulls the full nested context so the cache holds one
// canonical, fully-populated shape per loan.
const DETAIL_INCLUDE = 'customer,vehicle,created_by,updated_by'

// --------------------------------------------------
// Hooks
// --------------------------------------------------

export function useLoans(params: LoanListParams) {
  return useQuery({
    queryKey: loanKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<LoanListResponse>('/loans/', { params })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useLoan(id: string | undefined) {
  return useQuery({
    queryKey: loanKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<LoanResponse>(`/loans/${id}`, {
        params: { include: DETAIL_INCLUDE },
      })
      return data
    },
    enabled: !!id,
  })
}

export function useCreateLoan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoanCreate) => {
      const { data } = await apiClient.post<LoanResponse>('/loans/', payload)
      return data
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      // Seed the detail cache so the post-create redirect renders immediately.
      qc.setQueryData(loanKeys.detail(created.id), created)
      qc.invalidateQueries({ queryKey: loanKeys.byCustomer(created.customer_id) })
    },
  })
}

export function useUpdateLoan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoanUpdate) => {
      const { data } = await apiClient.patch<LoanResponse>(`/loans/${id}`, payload)
      return data
    },
    onSuccess: (updated) => {
      qc.setQueryData(loanKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: loanKeys.byCustomer(updated.customer_id) })
    },
  })
}

export function useDeleteLoan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/loans/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.removeQueries({ queryKey: loanKeys.detail(id) })
    },
  })
}

export interface LoanApproveRequest {
  // Required by the backend only when the loan has a down_payment > 0.
  down_payment_mode?: PaymentMethod | null
}

// Approve DRAFT -> ACTIVE. This is a member-path POST, so the global
// idempotency interceptor (which matches collection paths only) doesn't
// cover it — we attach the key explicitly to make the schedule + down-payment
// generation safe against double-submit.
export function useApproveLoan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoanApproveRequest) => {
      const { data } = await apiClient.post<LoanResponse>(`/loans/${id}/approve`, payload, {
        headers: { 'Idempotency-Key': uuidv4() },
      })
      return data
    },
    onSuccess: (updated) => {
      qc.setQueryData(loanKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: loanKeys.byCustomer(updated.customer_id) })
    },
  })
}
