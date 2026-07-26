import type { Dayjs } from 'dayjs'

export interface DateRangeValue {
  from: Dayjs | null
  to: Dayjs | null
}

export const EMPTY_RANGE: DateRangeValue = { from: null, to: null }

/** ISO date for the API, or undefined so the param is omitted entirely. */
export function isoOrUndefined(d: Dayjs | null): string | undefined {
  return d ? d.format('YYYY-MM-DD') : undefined
}

export function rangeError(value: DateRangeValue): string | null {
  const { from, to } = value
  if (from && to && to.isBefore(from, 'day')) {
    return 'The end date must be on or after the start date.'
  }
  return null
}
