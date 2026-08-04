import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import type { DocCategory } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/document.py. Documents are stored on S3;
// every document is owned by a customer and optionally linked to a loan /
// vehicle / transaction. Upload is multipart; download returns a presigned URL.
// --------------------------------------------------

export interface DocumentResponse {
  id: string
  customer_id: string
  loan_id: string | null
  transaction_id: string | null
  vehicle_id: string | null
  doc_type: DocCategory
  s3_key: string
  file_name: string | null
  content_type: string | null
  file_size: number | null
  file_hash: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
  is_deleted: boolean
  uploaded_by_name: string | null
  file_size_display: string | null
}

export interface DocumentListResponse {
  total: number
  page: number
  page_size: number
  results: DocumentResponse[]
}

export interface DocumentDownloadResponse {
  document_id: string
  file_name: string | null
  download_url: string
  expires_in_seconds: number
}

export interface DocumentListParams {
  customer_id?: string
  loan_id?: string
  vehicle_id?: string
  doc_type?: DocCategory
  page?: number
  page_size?: number
}

export const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (params: DocumentListParams) => [...documentKeys.lists(), params] as const,
}

export function useDocuments(params: DocumentListParams, enabled = true) {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<DocumentListResponse>('/documents/', { params })
      return data
    },
    enabled,
    placeholderData: (prev) => prev,
  })
}

export interface UploadDocumentArgs {
  customer_id: string
  doc_type: DocCategory
  file: File
  loan_id?: string
  vehicle_id?: string
  transaction_id?: string
}

export function useUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: UploadDocumentArgs) => {
      const fd = new FormData()
      fd.append('customer_id', args.customer_id)
      fd.append('doc_type', args.doc_type)
      if (args.loan_id) fd.append('loan_id', args.loan_id)
      if (args.vehicle_id) fd.append('vehicle_id', args.vehicle_id)
      if (args.transaction_id) fd.append('transaction_id', args.transaction_id)
      fd.append('file', args.file)
      // Let axios set the multipart boundary; the idempotency key guards
      // against double-upload on retry.
      const { data } = await apiClient.post<DocumentResponse>('/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': uuidv4() },
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.lists() })
    },
  })
}

// Soft-delete a document (DELETE /documents/{id}). Used by "replace" flows to
// retire the previous file after a new one is uploaded.
export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: string) => {
      await apiClient.delete(`/documents/${documentId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.lists() })
    },
  })
}

// Un-archives a soft-deleted document (POST /documents/{id}/restore). Backs the
// short undo window offered right after a delete — the record and its S3 object
// are still there, so this is a pure metadata flip.
export function useRestoreDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { data } = await apiClient.post<DocumentResponse>(
        `/documents/${documentId}/restore`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.lists() })
    },
  })
}

// Fetches a short-lived presigned URL; caller opens it. Mutation (not query)
// because each call is an explicit user action and the URL expires.
export function useDocumentDownloadUrl() {
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { data } = await apiClient.get<DocumentDownloadResponse>(
        `/documents/${documentId}/download`,
      )
      return data
    },
  })
}
