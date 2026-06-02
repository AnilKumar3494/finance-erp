import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/user.py UserResponse/UserListResponse.
// Sourced from GET /auth/employees (admin-only). Used to populate the
// "assigned employee" picker on the customer create/edit form.
// --------------------------------------------------

export interface EmployeeResponse {
  id: string
  username: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
}

export interface EmployeeListResponse {
  total: number
  page: number
  page_size: number
  results: EmployeeResponse[]
}

export interface EmployeeListParams {
  search?: string
  page?: number
  page_size?: number
}

export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: EmployeeListParams) => [...employeeKeys.all, 'list', params] as const,
}

export function useEmployees(params: EmployeeListParams = {}, enabled = true) {
  return useQuery({
    queryKey: employeeKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<EmployeeListResponse>('/auth/employees', {
        params,
      })
      return data
    },
    enabled,
    placeholderData: (prev) => prev,
  })
}
