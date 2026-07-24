import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

import { tokenStorage } from '@/lib/storage'

// Endpoints where POSTs must carry an Idempotency-Key so retries don't
// double-create. Backend de-dupes by this key. Match is on the path portion
// only — collection endpoints, not sub-resources.
const IDEMPOTENT_POST_PATHS = new Set(['/customers', '/transactions', '/loans'])

// Prod sets VITE_API_BASE_URL to an absolute backend URL (Vercel dashboard).
// With no env file — a fresh clone running `pnpm dev` — fall back to a relative
// `/api/v1`, which the Vite dev proxy (see vite.config.ts) forwards to the
// local backend. Either way the app has a working base URL out of the box.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
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
  (res) => res,
  (error) => {
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
