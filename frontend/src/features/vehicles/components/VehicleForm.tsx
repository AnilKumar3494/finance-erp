import { useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'

import {
  useCreateVehicle,
  useUpdateVehicle,
  type VehicleResponse,
  type VehicleUpdate,
} from '@/api/queries/vehicles'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { AssetStatus } from '@/schemas/enums'
import { VEHICLE_PLATE_RE } from '@/schemas/primitives'
import { ASSET_STATUS_ORDER, VEHICLE_STATUS_META } from '../vehicleStatusMeta'

// --------------------------------------------------
// Shared vehicle form — drives both the standalone create page and the
// in-place edit on the detail page. Field validation mirrors the proven set in
// features/loans/sections/VehicleInfoSection.tsx (plate is validated
// case-insensitively and uppercased on save; money is non-negative; year is
// 1900..next year). chassis_number and `type` are immutable post-creation
// (backend VehicleUpdate forbids them), so the edit mode hides chassis behind a
// disabled input and never sends it.
// --------------------------------------------------

interface VehicleFormValues {
  plate_number: string
  make: string
  model: string
  year: string
  color: string
  chassis_number: string
  engine_number: string
  market_value: string
  purchase_cost: string
  status: AssetStatus
}

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 409)
      return detail ?? 'A vehicle with these details already exists.'
    if (error.response?.status === 403)
      return detail ?? 'You do not have permission to do this.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

function buildSchema(mode: 'create' | 'edit') {
  const maxYear = new Date().getFullYear() + 1
  const money0 = (s: string) =>
    s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)
  // Make/model/year are required when registering a new vehicle, optional when
  // editing (so an admin can clear a mistaken value).
  const required = mode === 'create'
  const text = (max: number, label: string) =>
    required
      ? z.string().trim().min(1, `${label} is required`).max(max)
      : z.string().trim().max(max)
  return z.object({
    // Plate is required but the Indian-format check is advisory only: legacy /
    // migrated records carry temporary-registration and other non-standard
    // plates that must still be editable. A non-blocking warning (below) flags
    // the mismatch instead of preventing submit.
    plate_number: z.string().trim().min(1, 'Registration number is required'),
    make: text(50, 'Make'),
    model: text(50, 'Model'),
    year: z.string().refine(
      (s) =>
        (!required && s.trim() === '') ||
        (Number.isInteger(Number(s)) && Number(s) >= 1900 && Number(s) <= maxYear),
      `Year must be between 1900 and ${maxYear}`,
    ),
    color: z.string().max(30),
    chassis_number: z.string().max(50),
    engine_number: z.string().max(50),
    market_value: z.string().refine(money0, 'Enter a valid amount'),
    purchase_cost: z.string().refine(money0, 'Enter a valid amount'),
    status: AssetStatus,
  })
}

type CreateProps = {
  mode: 'create'
  onCreated: (vehicle: VehicleResponse) => void
  onCancel: () => void
}

type EditProps = {
  mode: 'edit'
  vehicle: VehicleResponse
  onDone: () => void
}

export type VehicleFormProps = CreateProps | EditProps

export function VehicleForm(props: VehicleFormProps) {
  const isEdit = props.mode === 'edit'
  const vehicle = isEdit ? props.vehicle : null

  const create = useCreateVehicle()
  // useUpdateVehicle needs an id; pass a stable empty string in create mode (the
  // mutation is never fired there). Hooks must run unconditionally.
  const update = useUpdateVehicle(vehicle?.id ?? '')

  const schema = useMemo(() => buildSchema(props.mode), [props.mode])

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      plate_number: vehicle?.plate_number ?? '',
      make: vehicle?.make ?? '',
      model: vehicle?.model ?? '',
      year: vehicle?.year != null ? String(vehicle.year) : '',
      color: vehicle?.color ?? '',
      chassis_number: vehicle?.chassis_number ?? '',
      engine_number: vehicle?.engine_number ?? '',
      market_value: vehicle?.market_value ?? '',
      purchase_cost: vehicle?.purchase_cost ?? '',
      status: vehicle?.status ?? 'IN_YARD',
    },
  })

  // Advisory plate-format check — warns but never blocks (see buildSchema).
  const plateValue = useWatch({ control, name: 'plate_number' })
  const plateWarning =
    plateValue && plateValue.trim() !== '' && !VEHICLE_PLATE_RE.test(plateValue.trim().toUpperCase())
      ? 'Non-standard plate format — it will be saved as entered. Verify it matches the RC book.'
      : undefined

  const onSubmit = (v: VehicleFormValues) => {
    const trimOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
    const moneyOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim())

    if (props.mode === 'create') {
      create.mutate(
        {
          type: 'INVENTORY',
          status: v.status,
          plate_number: v.plate_number.trim().toUpperCase(),
          make: v.make.trim(),
          model: v.model.trim(),
          year: v.year.trim() === '' ? null : Number(v.year),
          color: trimOrNull(v.color),
          chassis_number: trimOrNull(v.chassis_number),
          engine_number: trimOrNull(v.engine_number),
          market_value: moneyOrUndef(v.market_value),
          purchase_cost: moneyOrUndef(v.purchase_cost),
        },
        { onSuccess: (created) => props.onCreated(created) },
      )
      return
    }

    const payload = buildDiff(v, props.vehicle)
    if (Object.keys(payload).length === 0) {
      props.onDone()
      return
    }
    update.mutate(payload, { onSuccess: () => props.onDone() })
  }

  const error = isEdit
    ? update.isError
      ? mapErr(update.error, 'Could not save the vehicle.')
      : null
    : create.isError
      ? mapErr(create.error, 'Could not register the vehicle.')
      : null
  const pending = isEdit ? update.isPending : create.isPending

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <Input
          id="veh_plate"
          label="Registration number"
          required
          placeholder="e.g. TN09AB1234"
          {...register('plate_number')}
          error={errors.plate_number?.message}
          warning={plateWarning}
        />
        <TwoCol>
          <Input
            id="veh_make"
            label="Make"
            required={!isEdit}
            {...register('make')}
            error={errors.make?.message}
          />
          <Input
            id="veh_model"
            label="Model"
            required={!isEdit}
            {...register('model')}
            error={errors.model?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id="veh_year"
            label="Year"
            required={!isEdit}
            inputMode="numeric"
            placeholder="e.g. 2022"
            {...register('year')}
            error={errors.year?.message}
          />
          <Input
            id="veh_color"
            label="Color"
            placeholder="Optional"
            {...register('color')}
            error={errors.color?.message}
          />
        </TwoCol>
        <TwoCol>
          {isEdit ? (
            // Chassis is the permanent VIN — immutable after creation (the
            // backend forbids changing it), so it's shown read-only here.
            <Input
              id="veh_chassis"
              label="Chassis number"
              disabled
              defaultValue={vehicle?.chassis_number ?? ''}
              hint="Chassis number can't be changed after creation"
            />
          ) : (
            <Input
              id="veh_chassis"
              label="Chassis number"
              placeholder="Optional"
              {...register('chassis_number')}
              error={errors.chassis_number?.message}
            />
          )}
          <Input
            id="veh_engine"
            label="Engine number"
            placeholder="Optional"
            {...register('engine_number')}
            error={errors.engine_number?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id="veh_market"
            label="Market value"
            inputMode="decimal"
            placeholder="Optional"
            {...register('market_value')}
            error={errors.market_value?.message}
          />
          <Input
            id="veh_cost"
            label="Purchase cost"
            inputMode="decimal"
            placeholder="Optional"
            {...register('purchase_cost')}
            error={errors.purchase_cost?.message}
          />
        </TwoCol>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Input
              id="veh_status"
              label="Status"
              select
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.status?.message}
            >
              {ASSET_STATUS_ORDER.map((s) => (
                <MenuItem key={s} value={s}>
                  {VEHICLE_STATUS_META[s].label}
                </MenuItem>
              ))}
            </Input>
          )}
        />

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn
            type="button"
            variant="ghost"
            onClick={() => (isEdit ? props.onDone() : props.onCancel())}
            disabled={pending}
          >
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={pending}>
            {isEdit ? 'Save vehicle' : 'Register vehicle'}
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

// Only changed fields. Money/year compared numerically; nullable text fields
// clear to null when emptied. chassis_number and `type` are never sent — they're
// immutable post-creation.
function buildDiff(v: VehicleFormValues, vehicle: VehicleResponse): VehicleUpdate {
  const p: VehicleUpdate = {}
  const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim())

  if (v.plate_number.trim().toUpperCase() !== vehicle.plate_number) {
    p.plate_number = v.plate_number.trim().toUpperCase()
  }
  if (textOrNull(v.make) !== vehicle.make) p.make = textOrNull(v.make)
  if (textOrNull(v.model) !== vehicle.model) p.model = textOrNull(v.model)

  const year = v.year.trim() === '' ? null : Number(v.year)
  if (year !== vehicle.year) p.year = year

  if (textOrNull(v.color) !== vehicle.color) p.color = textOrNull(v.color)
  if (textOrNull(v.engine_number) !== vehicle.engine_number) {
    p.engine_number = textOrNull(v.engine_number)
  }
  if (Number(v.market_value) !== Number(vehicle.market_value)) {
    p.market_value = v.market_value.trim()
  }
  if (Number(v.purchase_cost) !== Number(vehicle.purchase_cost)) {
    p.purchase_cost = v.purchase_cost.trim()
  }
  if (v.status !== vehicle.status) p.status = v.status

  return p
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}
