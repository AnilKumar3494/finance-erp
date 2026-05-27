import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { LoginPage } from '@/features/auth/pages/LoginPage'
import { sanitizeRedirect } from '@/features/auth/redirect'
import { tokenStorage } from '@/lib/storage'

// The _authed guard appends ?redirect=<original-href> when bouncing
// unauthenticated requests here, so the user can land back where they
// started after signing in.
const loginSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  // If a token already exists, skip the form entirely and bounce to target.
  // A stale/invalid token will get cleared by the 401 interceptor on the
  // next request and the user will land back here.
  beforeLoad: ({ search }) => {
    if (tokenStorage.get()) {
      throw redirect({ to: sanitizeRedirect(search.redirect) })
    }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const { redirect: redirectAfterLogin } = Route.useSearch()
  return <LoginPage redirectAfterLogin={redirectAfterLogin} />
}
