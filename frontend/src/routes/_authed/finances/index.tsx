import { createFileRoute } from '@tanstack/react-router'

import { LoansListPage } from '@/features/loans/pages/LoansListPage'
import { LOAN_SORT_FIELDS, type LoanSortField, type SortOrder } from '@/api/queries/loans'
import { LoanStatus } from '@/schemas/enums'

export interface LoansListSearch {
  page: number
  status?: LoanStatus
  customer_id?: string
  assigned_to?: string
  search?: string
  // Creation-date window (ISO yyyy-mm-dd), scoping the list.
  date_from?: string
  date_to?: string
  sort_by?: LoanSortField
  sort_order?: SortOrder
}

export const Route = createFileRoute('/_authed/finances/')({
  staticData: { title: 'Finances' },
  validateSearch: (raw: Record<string, unknown>): LoansListSearch => {
    const page = Number(raw.page)
    const status = LoanStatus.safeParse(raw.status)
    const customer_id =
      typeof raw.customer_id === 'string' && raw.customer_id.length > 0
        ? raw.customer_id
        : undefined
    const assigned_to =
      typeof raw.assigned_to === 'string' && raw.assigned_to.length > 0
        ? raw.assigned_to
        : undefined
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const sort_by =
      typeof raw.sort_by === 'string' &&
      (LOAN_SORT_FIELDS as readonly string[]).includes(raw.sort_by)
        ? (raw.sort_by as LoanSortField)
        : undefined
    const sort_order =
      raw.sort_order === 'asc' || raw.sort_order === 'desc'
        ? (raw.sort_order as SortOrder)
        : undefined
    const date_from =
      typeof raw.date_from === 'string' && raw.date_from.length > 0 ? raw.date_from : undefined
    const date_to =
      typeof raw.date_to === 'string' && raw.date_to.length > 0 ? raw.date_to : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      status: status.success ? status.data : undefined,
      customer_id,
      assigned_to,
      search,
      date_from,
      date_to,
      sort_by,
      sort_order,
    }
  },
  component: LoansListPage,
})
