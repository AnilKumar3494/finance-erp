import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import { loanKeys } from '@/api/queries/loans'
import type { BadDebtProposalStatus, LoanStatus } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/bad_debt_proposal.py
// --------------------------------------------------

export interface BadDebtProposalResponse {
  id: string
  loan_id: string
  status: BadDebtProposalStatus
  proposed_reason: string
  proposed_by_id: string | null
  proposed_at: string
  auto_proposed: boolean
  reviewed_by_id: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
}

// List items carry the joined loan + customer fields (backend
// BadDebtProposalListItem) so the cross-loan review queue renders without a
// per-row lookup. Extends the base proposal shape.
export interface BadDebtProposalListItem extends BadDebtProposalResponse {
  loan_number: string
  loan_status: LoanStatus
  principal: string
  customer_id: string
  customer_name: string
  customer_mobile: string
}

export interface BadDebtProposalListResponse {
  total: number
  page: number
  page_size: number
  results: BadDebtProposalListItem[]
}

export const badDebtKeys = {
  all: ['badDebtProposals'] as const,
  open: (loanId: string) => [...badDebtKeys.all, 'open', loanId] as const,
  worklist: (page: number, status: BadDebtProposalStatus) =>
    [...badDebtKeys.all, 'worklist', status, page] as const,
}

// Cross-loan bad-debt review queue (Collections → Bad debt lens, admin-only).
// Defaults to PROPOSED — the proposals awaiting an admin's approve/reject.
export function useBadDebtProposals(
  page: number,
  status: BadDebtProposalStatus = 'PROPOSED',
  enabled = true,
) {
  return useQuery({
    queryKey: badDebtKeys.worklist(page, status),
    queryFn: async () => {
      const { data } = await apiClient.get<BadDebtProposalListResponse>(
        '/bad-debt-proposals/',
        { params: { status, page, page_size: 20 } },
      )
      return data
    },
    enabled,
    placeholderData: (prev) => prev,
  })
}

// There is no "get the open proposal for a loan" endpoint, so we list the
// PROPOSED proposals (admin-only, low volume) and match by loan_id. Used by
// the review action when a loan is BAD_DEBT_PROPOSED.
export function useOpenBadDebtProposal(loanId: string, enabled: boolean) {
  return useQuery({
    queryKey: badDebtKeys.open(loanId),
    queryFn: async () => {
      const { data } = await apiClient.get<BadDebtProposalListResponse>(
        '/bad-debt-proposals/',
        { params: { status: 'PROPOSED', page_size: 200 } },
      )
      return data.results.find((p) => p.loan_id === loanId) ?? null
    },
    enabled,
  })
}

export interface BadDebtProposeRequest {
  proposed_reason: string
}

export function useProposeBadDebt(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BadDebtProposeRequest) => {
      const { data } = await apiClient.post<BadDebtProposalResponse>(
        `/loans/${loanId}/bad-debt/propose`,
        payload,
        { headers: { 'Idempotency-Key': uuidv4() } },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loanKeys.detail(loanId) })
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: badDebtKeys.all })
    },
  })
}

export interface BadDebtReviewArgs {
  proposalId: string
  decision: 'APPROVE' | 'REJECT'
  review_notes?: string
}

export function useReviewBadDebt(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ proposalId, decision, review_notes }: BadDebtReviewArgs) => {
      const { data } = await apiClient.post<BadDebtProposalResponse>(
        `/bad-debt-proposals/${proposalId}/review`,
        { decision, review_notes: review_notes || null },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loanKeys.detail(loanId) })
      qc.invalidateQueries({ queryKey: loanKeys.lists() })
      qc.invalidateQueries({ queryKey: badDebtKeys.all })
    },
  })
}
