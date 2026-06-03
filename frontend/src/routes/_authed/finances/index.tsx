import { createFileRoute } from '@tanstack/react-router'

import { LoansListPage } from '@/features/loans/pages/LoansListPage'
import { LoanStatus } from '@/schemas/enums'

export interface LoansListSearch {
  page: number
  status?: LoanStatus
  customer_id?: string
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
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      status: status.success ? status.data : undefined,
      customer_id,
    }
  },
  component: LoansListPage,
})
