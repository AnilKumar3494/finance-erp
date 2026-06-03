import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { IdentityProofType } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/identity_proof.py. An identity proof
// links a customer OR a personnel to a proof type, an optional transcribed
// id_number (masked for non-admins), and an optional uploaded document.
// --------------------------------------------------

export interface IdentityProofDocumentMini {
  id: string
  file_name: string | null
  content_type: string | null
  doc_type: string | null
}

export interface IdentityProofResponse {
  id: string
  customer_id: string | null
  personnel_id: string | null
  proof_type: IdentityProofType
  id_number: string | null
  document_id: string | null
  document: IdentityProofDocumentMini | null
  is_deleted: boolean
  created_at: string
  updated_at: string
  created_by_id: string | null
}

export interface IdentityProofListResponse {
  total: number
  page: number
  page_size: number
  results: IdentityProofResponse[]
}

export interface IdentityProofCreate {
  entity_type: 'customer' | 'personnel'
  entity_id: string
  proof_type: IdentityProofType
  id_number?: string | null
  document_id?: string | null
}

export const identityProofKeys = {
  all: ['identityProofs'] as const,
  byCustomer: (customerId: string) => [...identityProofKeys.all, 'customer', customerId] as const,
  byPersonnel: (personnelId: string) =>
    [...identityProofKeys.all, 'personnel', personnelId] as const,
}

// The backend requires exactly one of customer_id / personnel_id.
export function useCustomerIdentityProofs(customerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: identityProofKeys.byCustomer(customerId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<IdentityProofListResponse>('/identity-proofs/', {
        params: { customer_id: customerId },
      })
      return data
    },
    enabled: !!customerId && enabled,
  })
}

export function usePersonnelIdentityProofs(personnelId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: identityProofKeys.byPersonnel(personnelId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<IdentityProofListResponse>('/identity-proofs/', {
        params: { personnel_id: personnelId },
      })
      return data
    },
    enabled: !!personnelId && enabled,
  })
}

export function useCreateIdentityProof() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: IdentityProofCreate) => {
      const { data } = await apiClient.post<IdentityProofResponse>('/identity-proofs/', payload)
      return data
    },
    onSuccess: (created) => {
      if (created.customer_id) {
        qc.invalidateQueries({ queryKey: identityProofKeys.byCustomer(created.customer_id) })
      }
      if (created.personnel_id) {
        qc.invalidateQueries({ queryKey: identityProofKeys.byPersonnel(created.personnel_id) })
      }
    },
  })
}
