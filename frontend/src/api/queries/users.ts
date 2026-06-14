import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { employeeKeys } from '@/api/queries/employees'
import type { UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/user.py UserResponse / UserListResponse.
// Powers the Team management screen. Account creation is admin-provisioned: the
// admin sets a temporary password (no email/invite flow). `role` is decided by
// which create endpoint is hit — never sent in the body.
// --------------------------------------------------

export interface UserAccount {
  id: string
  username: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
}

export interface UserListResponse {
  total: number
  page: number
  page_size: number
  results: UserAccount[]
}

export interface UserListParams {
  search?: string
  role?: UserRole
  page?: number
  page_size?: number
}

// Shared payload for the create-employee / create-admin routes
// (backend AdminUserCreate). The target role is implied by the endpoint.
export interface AccountCreate {
  username: string
  email: string
  full_name?: string | null
  password: string
}

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params: UserListParams) => [...userKeys.lists(), params] as const,
}

// Invalidate the team roster AND the employee picker cache (employees.ts) so
// assignment dropdowns reflect new/removed/role-changed accounts.
function useInvalidateUsers() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: userKeys.all })
    qc.invalidateQueries({ queryKey: employeeKeys.all })
  }
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<UserListResponse>('/auth/users', { params })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useCreateEmployee() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (payload: AccountCreate) => {
      const { data } = await apiClient.post<UserAccount>('/auth/employee', payload)
      return data
    },
    onSuccess: invalidate,
  })
}

export function useCreateAdmin() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (payload: AccountCreate) => {
      const { data } = await apiClient.post<UserAccount>('/auth/admin', payload)
      return data
    },
    onSuccess: invalidate,
  })
}

export function useDeleteEmployee() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.delete(`/auth/employee/${userId}`)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteAdmin() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.delete(`/auth/admin/${userId}`)
    },
    onSuccess: invalidate,
  })
}

// PATCH /auth/users/{id}/role — SUPER_ADMIN only, EMPLOYEE <-> ADMIN.
export function useChangeUserRole() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const { data } = await apiClient.patch<UserAccount>(`/auth/users/${userId}/role`, {
        role,
      })
      return data
    },
    onSuccess: invalidate,
  })
}
