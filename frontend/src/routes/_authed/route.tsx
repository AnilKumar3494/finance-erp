import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { tokenStorage } from '@/lib/storage'

// Layout route that protects every child path.
// Guards on token presence only — server enforces actual authorization
// per request. A stale/invalid token still gets bounced via the 401
// interceptor in src/api/client.ts.
export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ location }) => {
    if (!tokenStorage.get()) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
  },
  component: () => <Outlet />,
})
