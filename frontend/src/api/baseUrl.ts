export const BASE_DOMAIN = 'sriadithyafinance.loan'

// One frontend build serves every tenant, so the backend is picked from the
// address the app was opened on: app.<domain> -> api.<domain>, and any other
// <x>.<domain> -> <x>-api.<domain>. An explicit VITE_API_BASE_URL (Vercel, local
// .env) wins; anything else falls back to the Vite dev proxy.
export function resolveApiBaseUrl(hostname: string, envUrl: string | undefined): string {
  if (envUrl) return envUrl
  const suffix = `.${BASE_DOMAIN}`
  if (hostname.endsWith(suffix)) {
    const label = hostname.slice(0, -suffix.length)
    if (label && !label.includes('.')) {
      const apiHost = label === 'app' ? `api${suffix}` : `${label}-api${suffix}`
      return `https://${apiHost}/api/v1`
    }
  }
  return '/api/v1'
}
