import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { useCustomers, type CustomerResponse } from '@/api/queries/customers'
import { FieldLabel } from '@/components/primitives'

interface CustomerPickerProps {
  value: CustomerResponse | null
  onChange: (customer: CustomerResponse | null) => void
  label?: string
  required?: boolean
  error?: string
  disabled?: boolean
}

export function CustomerPicker({
  value,
  onChange,
  label = 'Customer',
  required,
  error,
  disabled,
}: CustomerPickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue.trim()), 300)
    return () => clearTimeout(t)
  }, [inputValue])

  const query = useCustomers({
    page: 1,
    search: debouncedQuery || undefined,
    page_size: 20,
  })

  const options = query.data?.results ?? []

  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <Autocomplete<CustomerResponse>
        size="small"
        disabled={disabled}
        value={value}
        onChange={(_, next) => onChange(next)}
        inputValue={inputValue}
        onInputChange={(_, v) => setInputValue(v)}
        options={options}
        loading={query.isLoading || query.isFetching}
        getOptionLabel={(o) => o.full_name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={(x) => x}
        noOptionsText={debouncedQuery ? 'No matching customers' : 'Type to search'}
        renderOption={(props, option) => {
          const { key, ...rest } = props as typeof props & { key?: React.Key }
          return (
            <li key={key ?? option.id} {...rest}>
              <div>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {option.full_name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.mobile_number}
                  {option.assigned_employee_name
                    ? ` · ${option.assigned_employee_name}`
                    : ''}
                </Typography>
              </div>
            </li>
          )
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search by name or mobile…"
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
