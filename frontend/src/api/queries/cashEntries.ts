import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { reportKeys } from './reports'

// Non-loan cash movements (capital & expenses ledger). Admin-only endpoints.
export type CashEntryType = 'CAPITAL_IN' | 'OTHER_INCOME' | 'EXPENSE' | 'CAPITAL_OUT'

export const CASH_ENTRY_TYPE_LABELS: Record<CashEntryType, string> = {
  CAPITAL_IN: 'Capital in',
  OTHER_INCOME: 'Other income',
  EXPENSE: 'Expense',
  CAPITAL_OUT: 'Withdrawal',
}

export const CASH_IN_TYPES: readonly CashEntryType[] = ['CAPITAL_IN', 'OTHER_INCOME']

export interface CashEntry {
  id: string
  entry_type: CashEntryType
  entry_date: string
  amount: string
  category: string | null
  notes: string | null
  created_at: string
  created_by_id: string | null
}

export interface CashEntryList {
  total: number
  total_in: string
  total_out: string
  capital_in: string
  other_income: string
  expenses: string
  capital_out: string
  results: CashEntry[]
}

export interface CashEntryCreate {
  entry_type: CashEntryType
  entry_date: string
  amount: string
  category?: string
  notes?: string
}

export const cashEntryKeys = {
  all: ['cashEntries'] as const,
  list: (date1: string, date2: string, type: CashEntryType | '') =>
    [...cashEntryKeys.all, 'list', date1, date2, type] as const,
}

export function useCashEntries(
  date1: string,
  date2: string,
  type: CashEntryType | '',
  enabled = true,
) {
  return useQuery({
    queryKey: cashEntryKeys.list(date1, date2, type),
    queryFn: async () => {
      const { data } = await apiClient.get<CashEntryList>('/cash-entries/', {
        params: { date1, date2, entry_type: type || undefined },
      })
      return data
    },
    enabled: enabled && !!date1 && !!date2,
    placeholderData: (prev) => prev,
  })
}

// Cash entries feed the Day/Multi-Day report position, so any mutation also
// drops the cached day reports.
function invalidateCashBook(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: cashEntryKeys.all })
  qc.invalidateQueries({ queryKey: [...reportKeys.all, 'dayReport'] })
}

export function useCreateCashEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CashEntryCreate) => {
      const { data } = await apiClient.post<CashEntry>('/cash-entries/', payload)
      return data
    },
    onSuccess: () => invalidateCashBook(qc),
  })
}

export function useDeleteCashEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entryId: string) => {
      await apiClient.delete(`/cash-entries/${entryId}`)
    },
    onSuccess: () => invalidateCashBook(qc),
  })
}
