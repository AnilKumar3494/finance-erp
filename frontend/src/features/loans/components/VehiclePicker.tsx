import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { useVehicles, type VehicleResponse } from '@/api/queries/vehicles'
import { FieldLabel } from '@/components/primitives'

interface VehiclePickerProps {
  value: VehicleResponse | null
  onChange: (vehicle: VehicleResponse | null) => void
  label?: string
  required?: boolean
  error?: string
  disabled?: boolean
}

function describeVehicle(v: VehicleResponse): string {
  const parts = [v.make, v.model].filter(Boolean)
  return parts.length ? parts.join(' ') : '—'
}

// Only COLLATERAL vehicles in IN_YARD / MAINTENANCE can back a loan (see
// backend services/loan._resolve_pledgeable_vehicle). We narrow by type here;
// the status is shown per row and the backend rejects ineligible picks with a
// precise message at create time.
export function VehiclePicker({
  value,
  onChange,
  label = 'Vehicle (collateral)',
  required,
  error,
  disabled,
}: VehiclePickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue.trim()), 300)
    return () => clearTimeout(t)
  }, [inputValue])

  const query = useVehicles({
    page: 1,
    search: debouncedQuery || undefined,
    type: 'COLLATERAL',
    page_size: 20,
  })

  const options = query.data?.results ?? []

  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <Autocomplete<VehicleResponse>
        size="small"
        disabled={disabled}
        value={value}
        onChange={(_, next) => onChange(next)}
        inputValue={inputValue}
        onInputChange={(_, v) => setInputValue(v)}
        options={options}
        loading={query.isLoading || query.isFetching}
        getOptionLabel={(o) => o.plate_number}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={(x) => x}
        noOptionsText={debouncedQuery ? 'No matching vehicles' : 'Type a plate to search'}
        renderOption={(props, option) => {
          const { key, ...rest } = props as typeof props & { key?: React.Key }
          return (
            <li key={key ?? option.id} {...rest}>
              <div>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {option.plate_number}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {describeVehicle(option)} · {option.status.replace(/_/g, ' ')}
                </Typography>
              </div>
            </li>
          )
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search by plate number…"
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
