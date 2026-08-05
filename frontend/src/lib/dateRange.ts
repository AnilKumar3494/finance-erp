import type { Dayjs } from 'dayjs'

export interface DateRangeValue {
  from: Dayjs | null
  to: Dayjs | null
}

export const EMPTY_RANGE: DateRangeValue = { from: null, to: null }

/**
 * ISO date for the API, or undefined so the param is omitted entirely.
 *
 * The validity check matters: a picker emits a half-built Dayjs on every
 * keystroke while a date is TYPED rather than picked, and `format` turns an
 * invalid one into the literal string "Invalid Date", which every report
 * endpoint rejects with a 422. Treating invalid as "no bound" keeps the
 * report unbounded until the typed date is actually complete.
 */
export function isoOrUndefined(d: Dayjs | null): string | undefined {
  return d && d.isValid() ? d.format('YYYY-MM-DD') : undefined
}

/**
 * Guard for a date picker's `onChange`. Same hazard as `isoOrUndefined`, at
 * the other end: a bare `d && set(d)` accepts a half-built Dayjs, because an
 * invalid one is still a non-null object. Reports whose date params are
 * required cannot fall back to "no bound", so they keep the last good value
 * until the typed date is complete.
 */
export function onlyValidDate(set: (d: Dayjs) => void) {
  return (d: Dayjs | null) => {
    if (d && d.isValid()) set(d)
  }
}

export function rangeError(value: DateRangeValue): string | null {
  const { from, to } = value
  if (from && to && to.isBefore(from, 'day')) {
    return 'The end date must be on or after the start date.'
  }
  return null
}
