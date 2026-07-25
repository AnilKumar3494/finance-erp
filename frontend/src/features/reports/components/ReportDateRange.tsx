import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'

import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import { Btn } from '@/components/primitives'
import { FieldLabel } from '@/components/primitives/FieldLabel'
import { EMPTY_RANGE, type DateRangeValue } from '../dateRange'

interface ReportDateRangeProps {
  idPrefix: string
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  fromLabel?: string
  toLabel?: string
  children?: ReactNode
}

/**
 * From/To pickers for the reports that scope by a date window.
 *
 * Both ends are optional and start empty, which the API reads as "no bound" —
 * so an untouched report still shows everything, exactly as it did before the
 * filter existed.
 */
export function ReportDateRange({
  idPrefix,
  value,
  onChange,
  fromLabel = 'From',
  toLabel = 'To',
  children,
}: ReportDateRangeProps) {
  const hasRange = Boolean(value.from || value.to)

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}
    >
      <Box sx={{ minWidth: 190 }}>
        <FieldLabel htmlFor={`${idPrefix}-from`}>{fromLabel}</FieldLabel>
        <DatePicker
          value={value.from}
          onChange={(d) => onChange({ ...value, from: d })}
          format="DD MMM YYYY"
          maxDate={dayjs()}
          slotProps={{
            textField: { id: `${idPrefix}-from`, size: 'small', fullWidth: true },
            field: { clearable: true },
          }}
        />
      </Box>
      <Box sx={{ minWidth: 190 }}>
        <FieldLabel htmlFor={`${idPrefix}-to`}>{toLabel}</FieldLabel>
        <DatePicker
          value={value.to}
          onChange={(d) => onChange({ ...value, to: d })}
          format="DD MMM YYYY"
          maxDate={dayjs()}
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
