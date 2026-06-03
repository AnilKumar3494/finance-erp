import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { useEmployees, type EmployeeResponse } from '@/api/queries/employees'
import { FieldLabel } from '@/components/primitives'

interface EmployeePickerProps {
  value: EmployeeResponse | null
  onChange: (employee: EmployeeResponse | null) => void
  label?: string
  required?: boolean
  error?: string
  disabled?: boolean
}

export function EmployeePicker({
  value,
  onChange,
  label = 'Assigned employee',
  required,
  error,
  disabled,
}: EmployeePickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue.trim()), 300)
    return () => clearTimeout(t)
  }, [inputValue])

  const query = useEmployees({
    search: debouncedQuery || undefined,
    page_size: 20,
  })

  const options = query.data?.results ?? []

  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <Autocomplete<EmployeeResponse>
        size="small"
        disabled={disabled}
        value={value}
        onChange={(_, next) => onChange(next)}
        inputValue={inputValue}
        onInputChange={(_, v) => setInputValue(v)}
        options={options}
        loading={query.isLoading || query.isFetching}
        getOptionLabel={(o) => o.full_name?.trim() || o.username}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={(x) => x}
        noOptionsText={
          query.isError
            ? 'Could not load employees. Check your connection and try again.'
            : debouncedQuery
              ? 'No matching employees'
              : 'Type to search'
        }
        renderOption={(props, option) => {
          const { key, ...rest } = props as typeof props & { key?: React.Key }
          return (
            <li key={key ?? option.id} {...rest}>
              <div>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {option.full_name?.trim() || option.username}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  @{option.username} · {option.email}
                </Typography>
              </div>
            </li>
          )
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search by name, username, or email…"
            error={!!error}
          />
        )}
      />
      {error && (
        <Typography
          role="alert"
          sx={{ mt: 0.5, fontSize: 11, fontWeight: 500, color: 'error.main' }}
        >
          {error}
        </Typography>
      )}
    </div>
  )
}
