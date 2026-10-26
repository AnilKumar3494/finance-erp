import { useEffect } from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { useBranding } from '@/api/queries/settings'
import { ServerWakingOverlay } from '@/components/ServerWakingOverlay'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { display_name } = useBranding()

  useEffect(() => {
    document.title = display_name
  }, [display_name])

  return (
    <>
      <Outlet />
      <ServerWakingOverlay />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  )
}
