import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { StabilityDocType } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/stability_document.py. Stability docs
// are loan-scoped (property tax, bank statement, cheque PDC, etc.) and
// optionally reference an uploaded document.
// --------------------------------------------------

export interface StabilityDocumentMini {
  id: string
  file_name: string | null
  content_type: string | null
  doc_type: string | null
}

export interface StabilityDocumentResponse {
  id: string
  loan_id: string
  doc_subtype: StabilityDocType
  description: string | null
  cheque_count: number | null
  document_id: string | null
  document: StabilityDocumentMini | null
  is_deleted: boolean
  created_at: string
  updated_at: string
  created_by_id: string | null
}

export interface StabilityDocumentListResponse {
  total: number
  page: number
  page_size: number
  results: StabilityDocumentResponse[]
}

export interface StabilityDocumentCreate {
  doc_subtype: StabilityDocType
  description?: string | null
  cheque_count?: number | null
  document_id?: string | null
}

export const stabilityDocKeys = {
  all: ['stabilityDocs'] as const,
  byLoan: (loanId: string) => [...stabilityDocKeys.all, 'byLoan', loanId] as const,
}

export function useStabilityDocs(loanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: stabilityDocKeys.byLoan(loanId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<StabilityDocumentListResponse>(
        `/loans/${loanId}/stability-docs`,
      )
      return data
    },
    enabled: !!loanId && enabled,
  })
}

export function useCreateStabilityDoc(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: StabilityDocumentCreate) => {
      const { data } = await apiClient.post<StabilityDocumentResponse>(
        `/loans/${loanId}/stability-docs`,
        payload,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stabilityDocKeys.byLoan(loanId) })
    },
  })
}
