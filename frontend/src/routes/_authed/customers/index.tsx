import { createFileRoute } from '@tanstack/react-router'

import { CustomersListPage } from '@/features/customers/pages/CustomersListPage'
import type { CustomerSortField, SortOrder } from '@/api/queries/customers'

export interface CustomersListSearch {
  page: number
  search?: string
  sort_by?: CustomerSortField
  sort_order?: SortOrder
}

const SORT_FIELDS: readonly CustomerSortField[] = [
  'full_name',
  'mobile_number',
  'created_at',
  'updated_at',
  'assigned_employee_name',
]

export const Route = createFileRoute('/_authed/customers/')({
  staticData: { title: 'Customers' },
  validateSearch: (raw: Record<string, unknown>): CustomersListSearch => {
    const page = Number(raw.page)
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const sort_by =
      typeof raw.sort_by === 'string' &&
      (SORT_FIELDS as readonly string[]).includes(raw.sort_by)
        ? (raw.sort_by as CustomerSortField)
        : undefined
    const sort_order =
      raw.sort_order === 'asc' || raw.sort_order === 'desc'
        ? (raw.sort_order as SortOrder)
        : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      search,
      sort_by,
      sort_order,
    }
  },
  component: CustomersListPage,
})
