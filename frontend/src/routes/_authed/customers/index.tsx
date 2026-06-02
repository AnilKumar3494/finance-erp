import { createFileRoute } from '@tanstack/react-router'

import { CustomersListPage } from '@/features/customers/pages/CustomersListPage'

export interface CustomersListSearch {
  page: number
  search?: string
}

export const Route = createFileRoute('/_authed/customers/')({
  staticData: { title: 'Customers' },
  validateSearch: (raw: Record<string, unknown>): CustomersListSearch => {
    const page = Number(raw.page)
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      search,
    }
  },
  component: CustomersListPage,
})
