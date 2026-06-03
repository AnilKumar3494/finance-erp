import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import type { PersonnelRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/personnel.py. Aadhaar/PAN arrive masked.
// Read-only here: linking/unlinking personnel is a later pass.
// --------------------------------------------------

export interface PersonnelResponse {
  id: string
  full_name: string
  mobile_number: string
  date_of_birth: string | null
  alt_mobile_number: string | null
  aadhaar_number: string | null
  pan_number: string | null
  address_line_1: string | null
  address_line_2: string | null
  mandal_village: string | null
  pincode: string | null
  remarks: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
  created_by_id: string | null
}

export interface LoanPersonnelResponse {
  id: string
  loan_id: string
  personnel_id: string
  role: PersonnelRole
  relationship_to_hirer: string | null
  created_at: string
  personnel: PersonnelResponse
}

export interface LoanPersonnelListResponse {
  total: number
  page: number
  page_size: number
  results: LoanPersonnelResponse[]
}

export const personnelKeys = {
  all: ['personnel'] as const,
  byLoan: (loanId: string) => [...personnelKeys.all, 'byLoan', loanId] as const,
}

export function useLoanPersonnel(loanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: personnelKeys.byLoan(loanId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<LoanPersonnelListResponse>(
        `/loans/${loanId}/personnel`,
      )
      return data
    },
    enabled: !!loanId && enabled,
  })
}

// --------------------------------------------------
// Write — mirror backend PersonnelCreate / LoanPersonnelCreate.
// full_name + mobile_number are required; the rest optional.
// --------------------------------------------------

export interface PersonnelCreate {
  full_name: string
  mobile_number: string
  date_of_birth?: string | null
  alt_mobile_number?: string | null
  aadhaar_number?: string | null
  pan_number?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  mandal_village?: string | null
  pincode?: string | null
  remarks?: string | null
}

export interface LoanPersonnelCreate {
  personnel_id: string
  role: PersonnelRole
  relationship_to_hirer?: string | null
}

export function useCreatePersonnel() {
  return useMutation({
    mutationFn: async (payload: PersonnelCreate) => {
      const { data } = await apiClient.post<PersonnelResponse>('/personnel/', payload, {
        headers: { 'Idempotency-Key': uuidv4() },
      })
      return data
    },
  })
}

export function useAddPersonnelToLoan(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoanPersonnelCreate) => {
      const { data } = await apiClient.post<LoanPersonnelResponse>(
        `/loans/${loanId}/personnel`,
        payload,
        { headers: { 'Idempotency-Key': uuidv4() } },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personnelKeys.byLoan(loanId) })
    },
  })
}

export function useRemovePersonnelFromLoan(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (loanPersonnelId: string) => {
      await apiClient.delete(`/loans/${loanId}/personnel/${loanPersonnelId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personnelKeys.byLoan(loanId) })
    },
  })
}
