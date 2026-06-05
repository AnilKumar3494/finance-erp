import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { CycleStatus } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/due_cycle.py. Monetary fields are
// strings. Read-only here: classify/reclassify is a separate admin workflow.
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
