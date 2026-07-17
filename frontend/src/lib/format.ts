import dayjs from 'dayjs'

// --------------------------------------------------
// Currency
// --------------------------------------------------

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  // Amounts are tracked to the paisa (Numeric(15,2) on the backend); always
  // render two decimals so values are never silently rounded to whole rupees.
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function fmtINR(n: number): string {
  return inrFormatter.format(n)
}

const inrApproxFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

// Whole rupees — the deliberate exception to fmtINR's always-two-decimals rule,
// and ONLY for figures already presented as approximations: chart axis labels,
// and prose like "on average they owe about ₹29,293". Never use this for an
// amount anyone acts on (a due, a receipt, a statement line) — that is what
// fmtINR is for, and rounding one silently would be exactly the bug its comment
// above warns about.
export function fmtINRApprox(n: number): string {
  return inrApproxFormatter.format(n)
}

const inrNumberFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// ASCII money for jsPDF documents — the built-in Helvetica is WinAnsi-encoded
// and has no ₹ (U+20B9) glyph, so PDFs write "Rs." instead.
export function fmtINRPdf(v: string | number): string {
  const n = Number(v)
  // Negated zero fields would otherwise print as "Rs. -0.00".
  return `Rs. ${inrNumberFormatter.format(n === 0 ? 0 : n)}`
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

// Date + time formatted in India Standard Time, regardless of the user's
// system timezone. Backend timestamps are UTC ISO strings; we pin display
// to IST so operations staff in different states see the same wall-clock
// audit trail. Uses Intl directly to avoid pulling in the dayjs timezone
// plugin.
const istDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

export function fmtDateTime(d: dayjs.ConfigType): string {
  if (d == null) return ''
  const parsed = dayjs(d)
  if (!parsed.isValid()) return ''
  return `${istDateTimeFormatter.format(parsed.toDate())} IST`
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
