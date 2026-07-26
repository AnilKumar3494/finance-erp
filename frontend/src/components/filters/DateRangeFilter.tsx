import type { ReactNode } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'

import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import { Btn } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { EMPTY_RANGE, type DateRangeValue } from '@/lib/dateRange'

interface DateRangeFilterProps {
  idPrefix: string
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  fromLabel?: string
  toLabel?: string
  // Latest selectable date. Defaults to today, which is what reports want (a
  // report of the future is meaningless). Pass null where future dates are
  // legitimate — the Collections worklist filters on EMI due dates, and most
  // of those are ahead of today.
  maxDate?: Dayjs | null
  children?: ReactNode
}

/**
 * From/To pickers for any list or report that scopes by a date window.
 *
 * Both ends are optional and start empty, which the API reads as "no bound" —
 * so an untouched view still shows everything, exactly as it did before the
 * filter existed.
 */
export function DateRangeFilter({
  idPrefix,
  value,
  onChange,
  fromLabel = 'From',
  toLabel = 'To',
  maxDate = dayjs(),
  children,
}: DateRangeFilterProps) {
  const hasRange = Boolean(value.from || value.to)

  // Gap, not Stack `spacing` — spacing adds a left margin that survives
  // wrapping, which indented the second picker on a narrow screen.
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}>
      <Box sx={{ flex: '1 1 190px', maxWidth: { sm: 240 } }}>
        <FieldLabel htmlFor={`${idPrefix}-from`}>{fromLabel}</FieldLabel>
        <DatePicker
          value={value.from}
          onChange={(d) => onChange({ ...value, from: d })}
          format="DD MMM YYYY"
          maxDate={maxDate ?? undefined}
          slotProps={{
            textField: { id: `${idPrefix}-from`, size: 'small', fullWidth: true },
            field: { clearable: true },
          }}
        />
      </Box>
      <Box sx={{ flex: '1 1 190px', maxWidth: { sm: 240 } }}>
        <FieldLabel htmlFor={`${idPrefix}-to`}>{toLabel}</FieldLabel>
        <DatePicker
          value={value.to}
          onChange={(d) => onChange({ ...value, to: d })}
          format="DD MMM YYYY"
          maxDate={maxDate ?? undefined}
          slotProps={{
            textField: { id: `${idPrefix}-to`, size: 'small', fullWidth: true },
            field: { clearable: true },
          }}
        />
      </Box>
      {hasRange && (
        <Btn variant="ghost" onClick={() => onChange(EMPTY_RANGE)}>
          Clear dates
        </Btn>
      )}
      {children}
    </Stack>
  )
}
