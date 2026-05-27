import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { tokenStorage } from '@/lib/storage'
import type { UserRole } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/user.py
// --------------------------------------------------

export interface MeResponse {
  id: string
  username: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
}

interface TokenResponse {
  access_token: string
  token_type: string
}

export interface LoginCredentials {
  username: string
  password: string
}

// --------------------------------------------------
// Query keys
// --------------------------------------------------

export const authKeys = {
  me: ['me'] as const,
}

// --------------------------------------------------
// Hooks
// --------------------------------------------------

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (creds: LoginCredentials) => {
      // Backend uses OAuth2PasswordRequestForm → x-www-form-urlencoded.
      const body = new URLSearchParams()
      body.append('username', creds.username)
      body.append('password', creds.password)
      const { data } = await apiClient.post<TokenResponse>('/auth/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      return data
    },
    onSuccess: (data) => {
      tokenStorage.set(data.access_token)
      qc.invalidateQueries({ queryKey: authKeys.me })
    },
  })
}

export function useMe() {
  // Gate the request on token presence so we don't fire /auth/me before login.
  // Reactivity relies on the consuming component re-rendering when the token
  // state changes — AuthProvider owns that state.
  const tokenPresent = !!tokenStorage.get()
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      const { data } = await apiClient.get<MeResponse>('/auth/me')
      return data
    },
    enabled: tokenPresent,
    staleTime: Infinity,
    retry: false,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useCallback(() => {
    tokenStorage.clear()
    // clear() over invalidateQueries() — on logout we want every cached
    // server-state gone, not just marked stale.
    qc.clear()
  }, [qc])
}
