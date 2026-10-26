import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

import { tokenStorage } from '@/lib/storage'
import { resolveApiBaseUrl } from './baseUrl'
import { isServerWakingError, markServerAwake, retryWhileWaking } from './serverWake'

// Endpoints where POSTs must carry an Idempotency-Key so retries don't
// double-create. Backend de-dupes by this key. Match is on the path portion
// only — collection endpoints, not sub-resources.
const IDEMPOTENT_POST_PATHS = new Set(['/customers', '/transactions', '/loans'])

// See resolveApiBaseUrl: VITE_API_BASE_URL when set (Vercel dashboard, local
// .env), else the tenant's API derived from the hostname on the franchise
// domain, else a relative `/api/v1` that the Vite dev proxy (vite.config.ts)
// forwards to the local backend.
export const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(window.location.hostname, import.meta.env.VITE_API_BASE_URL),
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token = tokenStorage.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  if (config.method?.toLowerCase() === 'post' && config.url) {
    const path = config.url.split('?')[0].replace(/\/$/, '')
    // .has()/.set() on AxiosHeaders are case-insensitive — bracket access is not,
    // so a caller-supplied 'idempotency-key' could otherwise be silently overwritten.
    if (IDEMPOTENT_POST_PATHS.has(path) && !config.headers.has('Idempotency-Key')) {
      config.headers.set('Idempotency-Key', uuidv4())
    }
  }

  return config
})

apiClient.interceptors.response.use(
  (res) => {
    markServerAwake()
    return res
  },
  (error) => {
    if (isServerWakingError(error)) {
      return retryWhileWaking(error, apiClient.request)
    }
    if (error.response?.status === 401) {
      tokenStorage.clear()
      // Hard redirect so router state resets cleanly.
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  },
)
