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

export const tokenStorage = createStringStore('token') // finerp_token
export const themeStorage = createStringStore('theme') // finerp_theme
export const sidebarStorage = createStringStore('sidebar_collapsed') // finerp_sidebar_collapsed
