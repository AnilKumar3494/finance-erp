import { useCallback, useSyncExternalStore } from 'react'
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

// Mirrors backend PasswordChangeRequest. The new password carries the same
// complexity policy as account creation (8–64 chars, an uppercase + a number)
// and must differ from the current one.
export interface ChangePasswordPayload {
  current_password: string
  new_password: string
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

// Reactive read of the token via React 18's useSyncExternalStore. The store
// emits an event on every write, so /auth/me fires immediately after login
// (no manual reload) and clears on logout the same way.
function useToken(): string | null {
  return useSyncExternalStore(
    tokenStorage.subscribe,
    tokenStorage.get,
    () => null,
  )
}

export function useMe() {
  const token = useToken()
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      const { data } = await apiClient.get<MeResponse>('/auth/me')
      return data
    },
    enabled: !!token,
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

// POST /auth/me/password — self-service change. Returns 204 (no body) and does
// NOT re-issue a token. The server bumps the user's token_version, which
// revokes every JWT they hold INCLUDING the one that made this call, so a
// successful change leaves no usable session. Callers must sign the user out
// (see ChangePasswordDialog) rather than let the next request 401.
export function useChangePassword() {
  return useMutation({
    mutationFn: async (payload: ChangePasswordPayload) => {
      await apiClient.post('/auth/me/password', payload)
    },
  })
}
