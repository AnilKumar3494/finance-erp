import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      {/* Dev-only: `import.meta.env.DEV` is statically false in prod builds, so
          the devtools (and their import) are tree-shaken out of the bundle. */}
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </>
  )
}
