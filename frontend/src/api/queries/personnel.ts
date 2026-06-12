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

// Update the loan↔personnel LINK (currently just the relationship to the
// hirer). Mirrors backend LoanPersonnelUpdate (PATCH /loans/{id}/personnel/{id}).
export interface LoanPersonnelUpdate {
  relationship_to_hirer?: string | null
}

export interface PersonnelUnmaskedPII {
  aadhaar_number: string | null
  pan_number: string | null
}

// --------------------------------------------------
// Lookup — find an existing person by mobile/Aadhaar/PAN and see which
// finances they are already attached to. Mirrors backend PersonnelLookupResult
// (GET /personnel/lookup). Lets a recurring guarantor be re-linked instead of
// re-created (their mobile is unique, so a fresh create would 409).
// --------------------------------------------------

export interface LoanAssociationSummary {
  loan_personnel_id: string
  loan_id: string
  loan_number: string
  hp_number: string | null
  role: PersonnelRole
  relationship_to_hirer: string | null
  customer_name: string
}

export interface PersonnelLookupResult {
  found: boolean
  personnel: PersonnelResponse | null
  existing_loan_associations: LoanAssociationSummary[]
}

export interface PersonnelLookupParams {
  mobile_number?: string
  aadhaar_number?: string
  pan_number?: string
}

// The endpoint is a GET, but it writes an audit row server-side (it records
// which identifiers were probed), so model it as a user-triggered mutation.
export function usePersonnelLookup() {
  return useMutation({
    mutationFn: async (params: PersonnelLookupParams) => {
      const { data } = await apiClient.get<PersonnelLookupResult>('/personnel/lookup', {
        params,
      })
      return data
    },
  })
}

// Every call writes an audit row server-side (same rule as customer PII), so
// this is a user-triggered mutation, not a query.
export function useUnmaskPersonnelPII() {
  return useMutation({
    mutationFn: async (personnelId: string) => {
      const { data } = await apiClient.get<PersonnelUnmaskedPII>(
        `/personnel/${personnelId}/unmask`,
      )
      return data
    },
  })
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

// Partial update of a personnel record — mirror backend PersonnelUpdate
// (PATCH /personnel/{id}). full_name / mobile_number are NOT NULL at the DB
// level, so they are not nullable here. Sending null clears a nullable field.
export interface PersonnelUpdate {
  full_name?: string
  mobile_number?: string
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

// Scoped to a loan so the loan's personnel list is the cache we refresh.
export function useUpdatePersonnel(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      personnelId,
      payload,
    }: {
      personnelId: string
      payload: PersonnelUpdate
    }) => {
      const { data } = await apiClient.patch<PersonnelResponse>(
        `/personnel/${personnelId}`,
        payload,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personnelKeys.byLoan(loanId) })
    },
  })
}

export function useUpdateLoanPersonnel(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      loanPersonnelId,
      payload,
    }: {
      loanPersonnelId: string
      payload: LoanPersonnelUpdate
    }) => {
      const { data } = await apiClient.patch<LoanPersonnelResponse>(
        `/loans/${loanId}/personnel/${loanPersonnelId}`,
        payload,
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
