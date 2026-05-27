import { z } from 'zod'

// Indian PII and business-field validators. Patterns are locked — change only
// with product sign-off. Mirrors the formats accepted by the backend.

// --------------------------------------------------
// Raw regexes
// --------------------------------------------------

export const MOBILE_RE = /^[6-9]\d{9}$/
export const AADHAAR_RE = /^\d{12}$/
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/
export const PIN_RE = /^[1-9]\d{5}$/

// Standard state series (TN09AB1234, DL-3C-AB-1234) or BH/Bharat series
// (22-BH-1234-AA). Separators may be dash, space, or omitted.
export const VEHICLE_PLATE_RE =
  /^([A-Z]{2}[- ]?\d{1,2}[A-Z]?[- ]?[A-Z]{0,3}[- ]?\d{4}|\d{2}[- ]?BH[- ]?\d{4}[- ]?[A-Z]{1,2})$/

// --------------------------------------------------
// Numeric range bounds
// --------------------------------------------------

export const PRINCIPAL_RANGE = [1_000, 20_00_00_000] as const // ₹1,000 – ₹20 Cr
export const RATE_RANGE = [0.5, 45] as const // 0.5% – 45% p.a.
export const TENURE_MONTHS_RANGE = [1, 96] as const // 1 – 96 months

// --------------------------------------------------
// Boolean test helpers (for ad-hoc use outside Zod schemas)
// --------------------------------------------------

export const isValidMobile = (v: string) => MOBILE_RE.test(v)
export const isValidAadhaar = (v: string) => AADHAAR_RE.test(v)
export const isValidPan = (v: string) => PAN_RE.test(v)
export const isValidPin = (v: string) => PIN_RE.test(v)
export const isValidVehiclePlate = (v: string) => VEHICLE_PLATE_RE.test(v)

// --------------------------------------------------
// Zod schemas
// --------------------------------------------------

export const mobile = z
  .string()
  .regex(MOBILE_RE, 'Enter a 10-digit mobile number starting with 6, 7, 8, or 9')

export const aadhaar = z.string().regex(AADHAAR_RE, 'Aadhaar must be exactly 12 digits')

export const pan = z.string().regex(PAN_RE, 'PAN must be in the format AAAAA9999A (uppercase)')

export const pin = z
  .string()
  .regex(PIN_RE, 'PIN code must be 6 digits and cannot start with 0')

export const vehiclePlate = z
  .string()
  .regex(
    VEHICLE_PLATE_RE,
    'Enter a valid Indian vehicle plate (e.g. TN09AB1234 or 22BH1234AA)',
  )

export const principal = z
  .number()
  .min(
    PRINCIPAL_RANGE[0],
    `Principal must be at least ₹${PRINCIPAL_RANGE[0].toLocaleString('en-IN')}`,
  )
  .max(
    PRINCIPAL_RANGE[1],
    `Principal cannot exceed ₹${PRINCIPAL_RANGE[1].toLocaleString('en-IN')}`,
  )

export const rate = z
  .number()
  .min(RATE_RANGE[0], `Rate must be at least ${RATE_RANGE[0]}%`)
  .max(RATE_RANGE[1], `Rate cannot exceed ${RATE_RANGE[1]}%`)

export const tenureMonths = z
  .number()
  .int('Tenure must be a whole number of months')
  .min(TENURE_MONTHS_RANGE[0], `Tenure must be at least ${TENURE_MONTHS_RANGE[0]} month`)
  .max(TENURE_MONTHS_RANGE[1], `Tenure cannot exceed ${TENURE_MONTHS_RANGE[1]} months`)
