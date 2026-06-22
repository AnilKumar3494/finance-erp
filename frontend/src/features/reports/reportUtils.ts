import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs from 'dayjs'

// Friendly message for a failed report fetch. Reports are admin-gated server
// side, so a 403 means the viewer lacks report access despite the UI gate.
export function mapReportError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 403)
      return detail ?? 'You do not have access to this report.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this report.'
}

// "2026-06" → "Jun '26" for chart axes.
export function fmtMonthShort(ym: string): string {
  const d = dayjs(`${ym}-01`)
  return d.isValid() ? d.format("MMM 'YY") : ym
}

// Money strings arrive as backend Decimals; parse only here at the display edge.
export function money(s: string | null | undefined): number {
  return Number(s ?? '0')
}
