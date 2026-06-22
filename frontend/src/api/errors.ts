import { AxiosError } from 'axios'

/**
 * Pulls the human-readable message out of the backend's error envelope:
 *   { "error": { "type", "message", "code", "fields": [...] } }
 * Returns undefined for non-Axios errors or when no message is present, so
 * callers can fall back to their own per-status copy.
 */
export function serverMessage(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    const env = error.response?.data as { error?: { message?: unknown } } | undefined
    const msg = env?.error?.message
    if (typeof msg === 'string') return msg
  }
  return undefined
}

/** One field-level validation error from a 422 response. */
export type FieldError = { loc: string; msg: string }

/**
 * Returns the field-level validation errors from a 422 envelope, or undefined
 * when none are present. Useful for pinning messages to specific form inputs.
 */
export function serverFieldErrors(error: unknown): FieldError[] | undefined {
  if (error instanceof AxiosError) {
    const env = error.response?.data as
      | { error?: { fields?: unknown } }
      | undefined
    const fields = env?.error?.fields
    if (Array.isArray(fields)) {
      const parsed = fields.filter(
        (f): f is FieldError =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as FieldError).loc === 'string' &&
          typeof (f as FieldError).msg === 'string',
      )
      if (parsed.length > 0) return parsed
    }
  }
  return undefined
}
