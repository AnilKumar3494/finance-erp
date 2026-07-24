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

export interface DayReportReceipt {
  transaction_id: string
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  transaction_type: 'REGULAR' | 'DOWN_PAYMENT'
  payment_mode: string
  cycle_number: number | null
  collected_by: string | null
  amount: string
  ta_amount: string
}

export interface DayReportPayment {
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  description: string
  amount: string
}

export interface DayReportEntry {
  entry_id: string
  entry_type: 'CAPITAL_IN' | 'OTHER_INCOME' | 'EXPENSE' | 'CAPITAL_OUT'
  category: string | null
  notes: string | null
  amount: string
}

export interface DayReportDay {
  date: string
  opening_balance: string
  closing_balance: string
  // Totals include the capital/expense entries, not just loan money.
  total_receipts: string
  total_payments: string
  emi_collection: string
  ta_collection: string
  down_payments: string
  receipts: DayReportReceipt[]
  payments: DayReportPayment[]
  entries_in: DayReportEntry[]
  entries_out: DayReportEntry[]
}

export interface DayReport {
  date1: string
  date2: string
  // Rolling cash-book position: collections + capital/other income −
  // disbursements − expenses/withdrawals, cumulative since first record.
  opening_balance: string
  closing_balance: string
  total_receipts: string
  total_payments: string
  total_emi_collection: string
  total_ta_collection: string
  total_down_payments: string
  total_capital_in: string
  total_other_income: string
  total_expenses: string
  total_capital_out: string
  cash: string
  gpay: string
  phonepe: string
  bank_transfer: string
  other: string
  days: DayReportDay[]
}

export interface ReceivedInterestRow {
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  amount_paid: string
  received_interest: string
  transaction_count: number
}

export interface ReceivedInterestReport {
  date1: string
  date2: string
  total_amount_paid: string
  total_received_interest: string
  results: ReceivedInterestRow[]
}

export interface HpOutstandingRow {
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  branch_point: string | null
  status: string
  principal: string
  payable: string
  collected: string
  outstanding: string
}

export interface HpOutstandingReport {
  total_loans: number
  total_principal: string
  total_payable: string
  total_collected: string
  total_outstanding: string
  results: HpOutstandingRow[]
}

export interface HpReceivableRow {
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  outstanding: string
  receivable_interest: string
}

export interface HpReceivableReport {
  total_loans: number
  total_outstanding: string
  total_receivable_interest: string
  results: HpReceivableRow[]
}

export interface HpRegisterRow {
  loan_id: string
  loan_number: string
  hp_number: string | null
  customer_id: string
  customer_name: string
  customer_mobile: string
  vehicle_plate: string | null
  approval_date: string | null
  principal: string
  interest_rate: string | null
  tenure: number | null
  total_payable: string
  status: string
}

export interface HpRegisterReport {
  total_loans: number
  total_principal: string
  total_payable: string
  results: HpRegisterRow[]
}

export interface PnlExpenseCategory {
  category: string | null
  amount: string
}

export interface PnlReport {
  date1: string
  date2: string
  collections: string
  interest_received: string
  ta_income: string
  other_income: string
  total_income: string
  total_expenses: string
  expenses_by_category: PnlExpenseCategory[]
  net_profit: string
}

export interface CollectorCollectionRow {
  collector_id: string
  collector_name: string
  role: string
  is_active: boolean
  total_amount: string
  ta_amount: string
  transaction_count: number
  cash: string
  gpay: string
  phonepe: string
  bank_transfer: string
  other: string
}

export interface CollectionByCollectorReport {
  date1: string
  date2: string
  total_collected: string
  total_ta: string
  total_transactions: number
  results: CollectorCollectionRow[]
}

export interface BalanceSheetReport {
  as_of: string
  cash_in_hand: string
  receivable_principal: string
  unearned_interest: string
  receivable_total: string
  total_assets: string
  open_loans: number
  capital_in: string
  capital_out: string
  capital_net: string
  interest_earned: string
  other_income: string
  expenses: string
  bad_debt_written_off: string
  retained_earnings: string
  down_payments_received: string
  total_funded: string
  difference: string
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
  dayReport: (date1: string, date2: string) =>
    [...reportKeys.all, 'dayReport', date1, date2] as const,
  receivedInterest: (date1: string, date2: string) =>
    [...reportKeys.all, 'receivedInterest', date1, date2] as const,
  hpOutstanding: () => [...reportKeys.all, 'hpOutstanding'] as const,
  hpReceivable: () => [...reportKeys.all, 'hpReceivable'] as const,
  hpRegister: () => [...reportKeys.all, 'hpRegister'] as const,
  pnl: (date1: string, date2: string) => [...reportKeys.all, 'pnl', date1, date2] as const,
  balanceSheet: () => [...reportKeys.all, 'balanceSheet'] as const,
  collectionsByCollector: (date1: string, date2: string) =>
    [...reportKeys.all, 'collectionsByCollector', date1, date2] as const,
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

export type CustomerReportSortField =
  | 'full_name'
  | 'mobile_number'
  | 'active_loans'
  | 'principal'
  | 'paid'
  | 'outstanding'

export interface CustomerReportSort {
  sort_by?: CustomerReportSortField
  sort_order?: 'asc' | 'desc'
}

export function useCustomerReport(
  page: number,
  pageSize: number,
  enabled = true,
  sort?: CustomerReportSort,
) {
  return useQuery({
    queryKey: [...reportKeys.customers(page, pageSize), sort?.sort_by ?? null, sort?.sort_order ?? null],
    queryFn: async () => {
      const { data } = await apiClient.get<CustomerReport>('/reports/customers', {
        params: { page, page_size: pageSize, ...sort },
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

// Daily cash book. Single day = date1 === date2; the backend caps ranges at
// 92 days, and both endpoints below are admin-only.
export function useDayReport(date1: string, date2: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.dayReport(date1, date2),
    queryFn: async () => {
      const { data } = await apiClient.get<DayReport>('/reports/day-report', {
        params: { date1, date2 },
      })
      return data
    },
    enabled: enabled && !!date1 && !!date2,
    staleTime: REPORT_STALE_MS,
    placeholderData: (prev) => prev,
  })
}

export function useCollectionsByCollector(
  date1: string,
  date2: string,
  enabled = true,
) {
  return useQuery({
    queryKey: reportKeys.collectionsByCollector(date1, date2),
    queryFn: async () => {
      const { data } = await apiClient.get<CollectionByCollectorReport>(
        '/reports/collections-by-collector',
        { params: { date1, date2 } },
      )
      return data
    },
    enabled: enabled && !!date1 && !!date2,
    staleTime: REPORT_STALE_MS,
    placeholderData: (prev) => prev,
  })
}

// As-of-now HP portfolio reports (admin-only). Each returns every row in one
// response — the register views client-sort/filter/export them.
export function useHpOutstanding(enabled = true) {
  return useQuery({
    queryKey: reportKeys.hpOutstanding(),
    queryFn: async () => {
      const { data } = await apiClient.get<HpOutstandingReport>('/reports/hp-outstanding')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useHpReceivable(enabled = true) {
  return useQuery({
    queryKey: reportKeys.hpReceivable(),
    queryFn: async () => {
      const { data } = await apiClient.get<HpReceivableReport>('/reports/hp-receivable')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useHpRegister(enabled = true) {
  return useQuery({
    queryKey: reportKeys.hpRegister(),
    queryFn: async () => {
      const { data } = await apiClient.get<HpRegisterReport>('/reports/hp-register')
      return data
    },
    enabled,
    staleTime: REPORT_STALE_MS,
  })
}

export function useReceivedInterest(date1: string, date2: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.receivedInterest(date1, date2),
    queryFn: async () => {
      const { data } = await apiClient.get<ReceivedInterestReport>(
        '/reports/received-interest',
        { params: { date1, date2 } },
      )
      return data
    },
    enabled: enabled && !!date1 && !!date2,
    staleTime: REPORT_STALE_MS,
    placeholderData: (prev) => prev,
  })
}

export function usePnl(date1: string, date2: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.pnl(date1, date2),
    queryFn: async () => {
      const { data } = await apiClient.get<PnlReport>('/reports/pnl', {
        params: { date1, date2 },
      })
      return data
    },
    enabled: enabled && !!date1 && !!date2,
    staleTime: REPORT_STALE_MS,
    placeholderData: (prev) => prev,
  })
}

export function useBalanceSheet(enabled = true) {
  return useQuery({
    queryKey: reportKeys.balanceSheet(),
    queryFn: async () => {
      const { data } = await apiClient.get<BalanceSheetReport>('/reports/balance-sheet')
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
