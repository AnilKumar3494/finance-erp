import { useEffect } from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { useBranding } from '@/api/queries/settings'

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
      <TanStackRouterDevtools position="bottom-right" />
    </>
  )
}
