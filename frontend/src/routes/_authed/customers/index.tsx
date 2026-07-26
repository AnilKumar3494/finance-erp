import { createFileRoute } from '@tanstack/react-router'

import { CustomersListPage } from '@/features/customers/pages/CustomersListPage'
import {
  CUSTOMER_SORT_FIELDS,
  type CustomerSortField,
  type SortOrder,
} from '@/api/queries/customers'

export interface CustomersListSearch {
  page: number
  search?: string
  assigned_to?: string
  // Inclusive window on the customer's created date, ISO YYYY-MM-DD.
  date_from?: string
  date_to?: string
  sort_by?: CustomerSortField
  sort_order?: SortOrder
}

// Accept only a well-formed ISO date; anything else is dropped so a hand-edited
// URL can't push garbage into an API query param.
const isoDate = (raw: unknown): string | undefined =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined

export const Route = createFileRoute('/_authed/customers/')({
  staticData: { title: 'Customers' },
  validateSearch: (raw: Record<string, unknown>): CustomersListSearch => {
    const page = Number(raw.page)
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const sort_by =
      typeof raw.sort_by === 'string' &&
      (CUSTOMER_SORT_FIELDS as readonly string[]).includes(raw.sort_by)
        ? (raw.sort_by as CustomerSortField)
        : undefined
    const sort_order =
      raw.sort_order === 'asc' || raw.sort_order === 'desc'
        ? (raw.sort_order as SortOrder)
        : undefined
    const assigned_to =
      typeof raw.assigned_to === 'string' && raw.assigned_to.length > 0
        ? raw.assigned_to
        : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      search,
      assigned_to,
      date_from: isoDate(raw.date_from),
      date_to: isoDate(raw.date_to),
      sort_by,
      sort_order,
    }
  },
  component: CustomersListPage,
})
