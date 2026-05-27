import dayjs from 'dayjs'

// --------------------------------------------------
// Currency
// --------------------------------------------------

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function fmtINR(n: number): string {
  return inrFormatter.format(n)
}

// --------------------------------------------------
// Dates
// --------------------------------------------------

export function fmtDate(d: dayjs.ConfigType): string {
  // dayjs(undefined) returns "now" — explicitly reject nullish input so a
  // missing field doesn't render today's date silently.
  if (d == null) return ''
  const parsed = dayjs(d)
  return parsed.isValid() ? parsed.format('DD MMM YYYY') : ''
}

// --------------------------------------------------
// File size
// --------------------------------------------------

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// --------------------------------------------------
// PII masks
// --------------------------------------------------

// Strips non-digits before masking, so input like "1234 5678 9012" still works.
export function maskAadhaar(v: string): string {
  const digits = v.replace(/\D/g, '')
  if (digits.length < 4) return digits
  return `XXXX XXXX ${digits.slice(-4)}`
}

// Output shape: AB****234F (first 2 + 4 masked + last 4).
export function maskPan(v: string): string {
  const clean = v.replace(/\s/g, '').toUpperCase()
  if (clean.length < 6) return clean
  return `${clean.slice(0, 2)}****${clean.slice(-4)}`
}
