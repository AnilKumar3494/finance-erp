import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import type { ClosureType, LoanStatus, PaymentMethod, UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/loan.py exactly.
// Money (Numeric(15,2)) and rate (Numeric(5,2)) fields are serialized as
// JSON strings by the backend to preserve Decimal precision. Keep them as
// `string` end-to-end; parse only at display/validation boundaries.
// --------------------------------------------------

// EMI collection signal mirrored from the backend LoanResponse.emi_due_status.
export type EmiDueStatus = 'NONE' | 'DUE' | 'OVERDUE' | 'AWAITING_CONFIRMATION'

// Nested objects are populated only when the request passes `?include=`.
export interface LoanCustomerNested {
  id: string
  full_name: string
  mobile_number: string
  // Exposed by the backend CustomerNested schema; may be absent until that
  // change is deployed, so treat as optional.
  mandal_village?: string | null
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
  // Customer-facing hire-purchase number (HP No). null until entered in the
  // wizard's financial step. Shown as the primary loan id across the UI;
  // loan_number (LMS-…) stays as the internal id. Use loanDisplayId().
  hp_number: string | null
  // Financial terms are null on a DRAFT until the wizard's financial step.
  principal: string | null
  interest_rate: string | null
  tenure: number | null
  down_payment: string
  processing_fee: string
  documentation_fee: string
  dsc_fee: string
  rto_fee: string
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

  // EMI collection signal (computed per request). NONE unless the loan is
  // running and has a due/overdue cycle or a payment awaiting confirmation.
  emi_due_status: EmiDueStatus

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
  // HP No — optional at create (draft-first); the financials step sends it.
  hp_number?: string
  // Optional at create: a DRAFT finance starts with just a customer; the
  // financial step fills these in later via PATCH.
  principal?: string
  interest_rate?: string
  tenure?: number
  down_payment?: string
  processing_fee?: string
  documentation_fee?: string
  dsc_fee?: string
  rto_fee?: string
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
  hp_number?: string
  principal?: string
  interest_rate?: string
  tenure?: number
  down_payment?: string
  processing_fee?: string
  documentation_fee?: string
  dsc_fee?: string
  rto_fee?: string
  penalty_rate?: string
}

// Sortable columns — keep in lockstep with the backend _SORTABLE_COLUMNS dict
// in services/loan.py. "created_at" backs the SNO column.
export const LOAN_SORT_FIELDS = [
  'created_at',
  'approval_date',
  'full_name',
  'mandal_village',
  'status',
] as const

export type LoanSortField = (typeof LOAN_SORT_FIELDS)[number]

export type SortOrder = 'asc' | 'desc'

export interface LoanListParams {
  page: number
  page_size?: number
  customer_id?: string
  vehicle_id?: string
  // Filter by the customer's assigned employee (admin only — the backend
  // always scopes EMPLOYEE callers to themselves).
  assigned_employee_id?: string
  status?: LoanStatus
  include?: string
  search?: string
  sort_by?: LoanSortField
  sort_order?: SortOrder
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
      // Seed the detail cache so the post-create redirect renders immediately,
      // then refetch so the nested includes (customer, …) — absent from the
      // POST response — are populated.
      qc.setQueryData(loanKeys.detail(created.id), created)
      qc.invalidateQueries({ queryKey: loanKeys.detail(created.id) })
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
      // Refetch the detail (with its nested includes) rather than caching the
      // PATCH response: that response omits customer/vehicle/created_by/etc.,
      // so caching it would blank those nested objects. Linking a vehicle or
      // editing terms would then drop the saved data when a wizard section is
      // revisited (the section reads loan.vehicle / loan.customer).
      qc.invalidateQueries({ queryKey: loanKeys.detail(id) })
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
      // Seed for an instant status flip, then refetch so the nested includes
      // (customer, vehicle, …) the approve response omits stay populated.
      qc.setQueryData(loanKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: loanKeys.detail(id) })
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: loanKeys.byCustomer(updated.customer_id) })
    },
  })
}

// --------------------------------------------------
// Close — mirror backend/app/schemas/loan_closure.py. Money fields are
// strings. final_settlement_amount is required by the backend.
// --------------------------------------------------

export interface LoanCloseRequest {
  closure_type: ClosureType
  final_settlement_amount: string
  closing_charges?: string
  charge_waived?: boolean
  waiver_reason?: string | null
  amount_written_off?: string
  refund_due_to_customer?: string
  refund_status?: string | null
  closure_date?: string | null
  noc_issued?: boolean
  noc_reference?: string | null
  closure_remarks?: string | null
  supporting_document_id?: string | null
}

export interface LoanClosureResponse {
  id: string
  loan_id: string
  closure_type: ClosureType
  closing_charges: string
  charge_waived: boolean
  waiver_reason: string | null
  final_settlement_amount: string
  outstanding_at_closure: string
  amount_written_off: string
  refund_due_to_customer: string
  refund_status: string | null
  closure_date: string
  noc_issued: boolean
  noc_reference: string | null
  closure_remarks: string | null
  supporting_document_id: string | null
  closed_by_id: string | null
  superseded_by_id: string | null
  created_at: string
  updated_at: string
}

export function useCloseLoan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoanCloseRequest) => {
      const { data } = await apiClient.post<LoanClosureResponse>(`/loans/${id}/close`, payload, {
        headers: { 'Idempotency-Key': uuidv4() },
      })
      return data
    },
    onSuccess: (closure) => {
      // The response is a closure, not the loan — refetch the loan so its new
      // terminal status (CLOSED / BAD_DEBT) is reflected.
      qc.invalidateQueries({ queryKey: loanKeys.detail(id) })
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: ['transactions', 'summary', id] })
      qc.invalidateQueries({ queryKey: loanKeys.byCustomer(closure.loan_id) })
    },
  })
}
