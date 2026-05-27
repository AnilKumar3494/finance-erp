import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

import {
  useLogin,
  useLogout,
  useMe,
  type LoginCredentials,
  type MeResponse,
} from '@/api/queries/auth'

interface AuthContextValue {
  user: MeResponse | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (creds: LoginCredentials) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const meQuery = useMe()
  const loginMutation = useLogin()
  const logout = useLogout()

  const login = useCallback(
    async (creds: LoginCredentials) => {
      await loginMutation.mutateAsync(creds)
    },
    [loginMutation],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isAuthenticated: !!meQuery.data,
      // isLoading is true only during initial hydration (token present, /me in flight).
      // With no token, useMe is disabled and isLoading stays false.
      isLoading: meQuery.isLoading,
      login,
      logout,
    }),
    [meQuery.data, meQuery.isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
