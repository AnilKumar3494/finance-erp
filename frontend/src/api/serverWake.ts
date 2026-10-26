import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

// The app server powers off when idle. While it boots, the Cloudflare wake
// Worker (ops/wake-worker/) answers every API request with a 503 carrying
// this code, so requests are held and retried here until the real API answers.
const WAKING_CODE = 'SERVER_WAKING'
const RETRY_EVERY_MS = 5_000
const GIVE_UP_AFTER_MS = 4 * 60_000

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    wakeStartedAt?: number
  }
}

let waking = false
const listeners = new Set<() => void>()

function setWaking(next: boolean) {
  if (waking === next) return
  waking = next
  listeners.forEach((listener) => listener())
}

export function subscribeServerWaking(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isServerWaking() {
  return waking
}

export function markServerAwake() {
  setWaking(false)
}

export function isServerWakingError(error: unknown): error is AxiosError & {
  config: InternalAxiosRequestConfig
} {
  if (!(error instanceof AxiosError) || !error.config) return false
  const env = error.response?.data as { error?: { code?: unknown } } | undefined
  return error.response?.status === 503 && env?.error?.code === WAKING_CODE
}

// Retrying is safe even for POSTs: the request never reached the backend.
export async function retryWhileWaking<T>(
  error: AxiosError & { config: InternalAxiosRequestConfig },
  send: (config: InternalAxiosRequestConfig) => Promise<T>,
): Promise<T> {
  const config = error.config
  config.wakeStartedAt ??= Date.now()
  if (Date.now() - config.wakeStartedAt > GIVE_UP_AFTER_MS) {
    setWaking(false)
    throw error
  }
  setWaking(true)
  await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS))
  return send(config)
}
