import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

import { tokenStorage } from '@/lib/storage'

// Endpoints where POSTs must carry an Idempotency-Key so retries don't
// double-create. Backend de-dupes by this key. Match is on the path portion
// only — collection endpoints, not sub-resources.
const IDEMPOTENT_POST_PATHS = new Set(['/customers', '/transactions', '/loans'])

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
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
      // Hard redirect so router state resets cleanly. Preserve where the user
      // was (path + query) so login can send them back after re-auth — the
      // login route sanitises this via sanitizeRedirect before honouring it.
      if (window.location.pathname !== '/login') {
        const here = window.location.pathname + window.location.search
        window.location.assign(`/login?redirect=${encodeURIComponent(here)}`)
      }
    }
    return Promise.reject(error)
  },
)
