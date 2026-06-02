import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'

// --------------------------------------------------
// Types — mirror backend/app/schemas/customer.py
// Aadhaar/PAN come MASKED on every CustomerResponse. Use the dedicated
// unmask endpoint to retrieve raw values (audited every call).
// --------------------------------------------------

export interface CustomerResponse {
  id: string
  is_deleted: boolean
  created_by_id: string | null
  assigned_employee_id: string | null
  assigned_employee_name: string | null
  created_at: string
  updated_at: string
  full_name: string
  mobile_number: string
  aadhaar_number: string | null
  pan_number: string | null
  date_of_birth: string | null
  alt_mobile_number: string | null
  address_line_1: string | null
  address_line_2: string | null
  mandal_village: string | null
  pincode: string | null
  remarks: string | null
}

export interface CustomerListResponse {
  total: number
  page: number
  page_size: number
  results: CustomerResponse[]
}

export interface CustomerCreate {
  full_name: string
  mobile_number: string
  aadhaar_number?: string | null
  pan_number?: string | null
  assigned_employee_id?: string | null
  date_of_birth?: string | null
  alt_mobile_number?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  mandal_village?: string | null
  pincode?: string | null
  remarks?: string | null
}

// Partial update — omitting a field leaves it unchanged (backend uses
// model_dump(exclude_unset=True)). Sending null on nullable fields clears
// them. full_name / mobile_number are NOT NULL at the DB level, so we don't
// expose `| null` for those.
export interface CustomerUpdate {
  full_name?: string
  mobile_number?: string
  alt_mobile_number?: string | null
  aadhaar_number?: string | null
  pan_number?: string | null
  date_of_birth?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  mandal_village?: string | null
  pincode?: string | null
  remarks?: string | null
  assigned_employee_id?: string | null
}

export interface CustomerUnmaskedPII {
  aadhaar_number: string | null
  pan_number: string | null
}

export interface CustomerListParams {
  page: number
  page_size?: number
  search?: string
  assigned_employee_id?: string
}

// --------------------------------------------------
// Query keys
// --------------------------------------------------

export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  unmask: (id: string) => [...customerKeys.detail(id), 'unmask'] as const,
}

// --------------------------------------------------
// Hooks
// --------------------------------------------------

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<CustomerListResponse>('/customers/', {
        params,
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<CustomerResponse>(`/customers/${id}`)
      return data
    },
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CustomerCreate) => {
      const { data } = await apiClient.post<CustomerResponse>('/customers/', payload)
      return data
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: customerKeys.lists() })
      // Seed the detail cache so the post-create redirect renders immediately.
      qc.setQueryData(customerKeys.detail(created.id), created)
    },
  })
}

export function useDeleteCustomer(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/customers/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.lists() })
      qc.removeQueries({ queryKey: customerKeys.detail(id) })
    },
  })
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CustomerUpdate) => {
      const { data } = await apiClient.patch<CustomerResponse>(
        `/customers/${id}`,
        payload,
      )
      return data
    },
    onSuccess: (updated) => {
      qc.setQueryData(customerKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: customerKeys.lists() })
    },
  })
}

// Every call writes an audit row server-side. Caller decides when to fire
// it (typically a user-confirmed Reveal action), so this is a mutation,
// not a query.
export function useUnmaskCustomerPII() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.get<CustomerUnmaskedPII>(
        `/customers/${id}/unmask`,
      )
      return data
    },
  })
}
