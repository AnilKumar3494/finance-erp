import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/report.py. Decimal money/rate fields are
// serialized as strings to preserve precision; parse only at display.
// --------------------------------------------------

export interface DashboardSummary {
  total_customers: number
  total_draft_loans: number
  total_active_loans: number
  total_awaiting_closure_loans: number
  total_closed_loans: number
  total_bad_debt_proposed_loans: number
  total_bad_debt_loans: number
  total_vehicles: number
  total_documents: number
  total_principal_outstanding: string
  total_amount_collected: string
  total_pending_collections: string
}

export interface LoanPortfolioReport {
  total_loans: number
  draft_loans: number
  active_loans: number
  awaiting_closure_loans: number
  closed_loans: number
  bad_debt_proposed_loans: number
  bad_debt_loans: number
  total_principal: string
  total_payable: string
  total_collected: string
  total_outstanding: string
  average_interest_rate: string
  average_tenure: string
}

export interface CollectionEntry {
  date: string
  total_amount: string
  transaction_count: number
  cash: string
  gpay: string
  phonepe: string
  bank_transfer: string
  other: string
}

export interface CollectionReport {
  period: 'daily' | 'monthly'
  total_collected: string
  total_transactions: number
  entries: CollectionEntry[]
}

export interface CustomerStat {
  customer_id: string
  customer_name: string
  mobile_number: string
  active_loans: number
  total_principal: string
  total_paid: string
  total_outstanding: string
}

export interface CustomerReport {
  total_customers: number
  customers_with_active_loans: number
  page: number
  page_size: number
  results: CustomerStat[]
}

export interface EmployeePerformance {
  employee_id: string
  employee_name: string
  role: UserRole
  is_active: boolean
  assigned_customers: number
  total_collections: string
  transaction_count: number
}

export interface EmployeeReport {
  total_employees: number
  total_collections: string
  total_transactions: number
  results: EmployeePerformance[]
}

export interface ChartEntry {
  month: string // "YYYY-MM"
  amount: string
}

export interface MonthlyCount {
  month: string
  count: number
}

export interface MonthlyAmount {
  month: string
  amount: string
}

export interface MonthlyTrends {
  new_customers: MonthlyCount[]
  new_loans: MonthlyCount[]
  collections: MonthlyAmount[]
}

// --------------------------------------------------
// Query keys
// --------------------------------------------------

export const reportKeys = {
  all: ['reports'] as const,
  summary: () => [...reportKeys.all, 'summary'] as const,
  portfolio: () => [...reportKeys.all, 'portfolio'] as const,
  collections: (period: string, days: number) =>
    [...reportKeys.all, 'collections', period, days] as const,
  collectionChart: (months: number) =>
    [...reportKeys.all, 'collectionChart', months] as const,
  trends: (months: number) => [...reportKeys.all, 'trends', months] as const,
  customers: (page: number, pageSize: number) =>
    [...reportKeys.all, 'customers', page, pageSize] as const,
  employees: () => [...reportKeys.all, 'employees'] as const,
}

// Reports change slowly relative to a session; a short stale window keeps the
// dashboard snappy on tab switches without serving stale numbers for long.
const REPORT_STALE_MS = 60_000

// --------------------------------------------------
// Hooks — all read-only. `enabled` lets callers defer a fetch until the
// owning tab mounts and the viewer is permitted (most endpoints are admin).
// --------------------------------------------------

export function useDashboardSummary(enabled = true) {
  return useQuery({
    queryKey: reportKeys.summary(),
    queryFn: async () => {
      const { data } = await apiClient.get<DashboardSummary>('/reports/summary')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useLoanPortfolio(enabled = true) {
  return useQuery({
    queryKey: reportKeys.portfolio(),
    queryFn: async () => {
      const { data } = await apiClient.get<LoanPortfolioReport>('/reports/loans')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useCollectionReport(
  period: 'daily' | 'monthly',
  days: number,
  enabled = true,
) {
  return useQuery({
    queryKey: reportKeys.collections(period, days),
    queryFn: async () => {
      const { data } = await apiClient.get<CollectionReport>('/reports/collections', {
        params: { period, days },
      })
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useCollectionChart(months: number, enabled = true) {
  return useQuery({
    queryKey: reportKeys.collectionChart(months),
    queryFn: async () => {
      const { data } = await apiClient.get<ChartEntry[]>('/reports/charts/collections', {
        params: { months },
      })
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useMonthlyTrends(months: number, enabled = true) {
  return useQuery({
    queryKey: reportKeys.trends(months),
    queryFn: async () => {
      const { data } = await apiClient.get<MonthlyTrends>('/reports/trends', {
        params: { months },
      })
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useCustomerReport(page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: reportKeys.customers(page, pageSize),
    queryFn: async () => {
      const { data } = await apiClient.get<CustomerReport>('/reports/customers', {
        params: { page, page_size: pageSize },
      })
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useEmployeeReport(enabled = true) {
  return useQuery({
    queryKey: reportKeys.employees(),
    queryFn: async () => {
      const { data } = await apiClient.get<EmployeeReport>('/reports/employees')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

// --------------------------------------------------
// CSV export — the endpoint streams an authenticated CSV, so we fetch it as a
// blob (carrying the Bearer token via apiClient) and trigger a client-side
// download rather than navigating, which would drop the auth header.
// --------------------------------------------------

export async function downloadCustomerReportCsv(): Promise<void> {
  const res = await apiClient.get('/reports/customers/export', {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'customers_report.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
