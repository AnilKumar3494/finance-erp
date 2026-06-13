// Generate a strong temporary password that always satisfies both the client
// and backend rules (>=8 chars, >=1 uppercase, >=1 digit). We produce 14 chars
// and guarantee at least one lower, upper, and digit. Ambiguous characters
// (0/O/1/l/I) are excluded so the admin can read it out without confusion.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALL = LOWER + UPPER + DIGITS

function randomInt(maxExclusive: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]! % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!
}

export function generatePassword(length = 14): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS)]
  const rest = Array.from({ length: Math.max(length, 8) - required.length }, () =>
    pick(ALL),
  )
  const chars = [...required, ...rest]
  // Fisher–Yates shuffle so the guaranteed chars aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
