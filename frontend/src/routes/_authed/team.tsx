import { createFileRoute } from '@tanstack/react-router'

import { TeamPage } from '@/features/team/pages/TeamPage'
import { UserRole } from '@/schemas/enums'

export interface TeamSearch {
  page: number
  search?: string
  role?: UserRole
}

export const Route = createFileRoute('/_authed/team')({
  staticData: { title: 'Team' },
  validateSearch: (raw: Record<string, unknown>): TeamSearch => {
    const page = Number(raw.page)
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const role =
      typeof raw.role === 'string' && UserRole.options.includes(raw.role as UserRole)
        ? (raw.role as UserRole)
        : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      search,
      role,
    }
  },
  component: TeamPage,
})
