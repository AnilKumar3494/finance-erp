// Typed localStorage accessors for all app-owned keys.
// Every key lives under the `finerp_` namespace so we can `localStorage.clear()`
// app data without touching keys owned by other tools or browser extensions.

const NAMESPACE = 'finerp_'

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function createStringStore(suffix: string) {
  const key = `${NAMESPACE}${suffix}`
  return {
    key,
    get: () => safeGet(key),
    set: (v: string) => safeSet(key, v),
    clear: () => safeRemove(key),
  }
}

// Reactive variant — emits a same-tab event on every set/clear, and listens
// to the native `storage` event for cross-tab writes. Consumers subscribe via
// `useSyncExternalStore` so React components re-render when the value flips.
// Used for the auth token so `/auth/me` fires immediately after login without
// requiring a manual reload.
function createReactiveStringStore(suffix: string, eventName: string) {
  const key = `${NAMESPACE}${suffix}`
  const dispatch = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(eventName))
    }
  }
  return {
    key,
    get: () => safeGet(key),
    set: (v: string) => {
      safeSet(key, v)
      dispatch()
    },
    clear: () => {
      safeRemove(key)
      dispatch()
    },
    subscribe: (cb: () => void) => {
      if (typeof window === 'undefined') return () => {}
      const onStorage = (e: StorageEvent) => {
        // Native `storage` event only fires from OTHER tabs. Filter to our key
        // so we don't react to arbitrary localStorage writes.
        if (e.key === key) cb()
      }
      window.addEventListener(eventName, cb)
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener(eventName, cb)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}

export const tokenStorage = createReactiveStringStore(
  'token',
  'finerp:token-change',
) // finerp_token
export const themeStorage = createStringStore('theme') // finerp_theme
export const sidebarStorage = createStringStore('sidebar_collapsed') // finerp_sidebar_collapsed
