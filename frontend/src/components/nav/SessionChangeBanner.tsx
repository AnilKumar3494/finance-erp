import { useEffect, useState } from 'react'

import { Btn, ErrorBanner } from '@/components/primitives'
import { tokenStorage } from '@/lib/storage'

/**
 * Warns when another tab on the same browser/origin has signed in or out
 * as a different account, and forces the user to reload before continuing.
 *
 * localStorage is shared across every tab of the same origin, so the most
 * recent login wins for ALL open tabs. Closing the other tab does NOT
 * restore this tab's previous session — the token has already been
 * overwritten on disk. The only safe action is to reload and re-hydrate
 * the React tree against the new token; otherwise the next API call in
 * this tab silently runs as the new user while the UI still shows the
 * old user's name. We intentionally do not offer a dismiss action.
 *
 * Subscribes specifically to the native `storage` event — which only
 * fires for cross-tab writes, never the same tab — so a login or logout
 * triggered from THIS tab does not show the banner.
 */
export function SessionChangeBanner() {
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === tokenStorage.key) setChanged(true)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  if (!changed) return null

  return (
    <ErrorBanner
      severity="warning"
      variant="filled"
      sx={{ borderRadius: 0 }}
      action={
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => window.location.reload()}
          sx={{ color: 'inherit' }}
        >
          Reload
        </Btn>
      }
      message="Another tab on this browser signed in with a different account. Reload to continue safely — without a reload this tab may make backend requests as the new account."
    />
  )
}
