import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useUpdateLoan, type LoanResponse } from '@/api/queries/loans'
import {
  useCreateVehicle,
  useUpdateVehicle,
  useVehicle,
  type VehicleResponse,
  type VehicleUpdate,
} from '@/api/queries/vehicles'
import {
  useDeleteDocument,
  useDocuments,
  type DocumentResponse,
} from '@/api/queries/documents'
import { Btn, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { AssetStatus } from '@/schemas/enums'
import { VEHICLE_PLATE_RE } from '@/schemas/primitives'
import { fmtINR } from '@/lib/format'
import { EditableSection } from '../components/EditableSection'
import { Collapsible } from '../components/Collapsible'
import { FieldGrid, FieldRow } from '../components/DetailFields'
import { DocumentLine } from '../components/DocumentLine'
import type { SectionPermission } from '../financePermissions'
import type { ApprovalMissingField } from '../approvalReadiness'

const STATUS_LABELS: Record<AssetStatus, string> = {
  IN_YARD: 'In yard',
  SEIZED: 'Seized',
  MAINTENANCE: 'Maintenance',
  SOLD: 'Sold',
  WITH_CUSTOMER: 'With customer',
}

const money = (v: string | null | undefined) =>
  v != null && v !== '' ? fmtINR(Number(v)) : undefined

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (error.response?.status === 409) return detail ?? 'A vehicle with these details already exists.'
    if (error.response?.status === 403) return detail ?? 'You do not have permission to edit this vehicle.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function VehicleInfoSection({
  loan,
  perm,
  openSignal,
  missing,
}: {
  loan: LoanResponse
  perm: SectionPermission
  openSignal?: number
  missing?: ApprovalMissingField[]
}) {
  // The loan embeds only plate/make/model/year; fetch the full record so the
  // edit form and the read view cover every attribute.
  const vehicleQuery = useVehicle(loan.vehicle_id ?? undefined)
  const missingLabels = missing?.map((m) => m.label)
  const highlight = new Set(missing?.map((m) => m.field))

  if (!loan.vehicle_id) {
    return (
      <EditableSection
        title="Vehicle Information"
        sectionId="sec-vehicle"
        openSignal={openSignal}
        missing={missingLabels}
        canEdit={perm.canEdit}
        editLabel="Add vehicle"
        warning={perm.warning}
        view={
          <Typography variant="body2" color="text.secondary">
            No collateral attached to this finance.
            {perm.canEdit ? ' Use “Add vehicle” to attach one.' : ''}
          </Typography>
        }
        edit={(done) => <VehicleCreateForm loanId={loan.id} onDone={done} highlight={highlight} />}
      />
    )
  }

  if (vehicleQuery.isLoading) {
    return (
      <EditableSection
        title="Vehicle Information"
        canEdit={false}
        view={
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <Spinner size={22} />
          </Box>
        }
        edit={() => null}
      />
    )
  }

  if (vehicleQuery.isError || !vehicleQuery.data) {
    return (
      <EditableSection
        title="Vehicle Information"
        canEdit={false}
        view={<ErrorBanner message="Could not load the collateral vehicle." />}
        edit={() => null}
      />
    )
  }

  const vehicle = vehicleQuery.data

  return (
    <EditableSection
      title="Vehicle Information"
      sectionId="sec-vehicle"
      openSignal={openSignal}
      missing={missingLabels}
      subtitle={vehicle.plate_number}
      canEdit={perm.canEdit}
      warning={perm.warning}
      view={<VehicleView vehicle={vehicle} />}
      edit={(done) => <VehicleEditForm vehicle={vehicle} onDone={done} highlight={highlight} />}
      footer={
        <VehicleDocs
          vehicleId={vehicle.id}
          customerId={loan.customer_id}
          canEdit={perm.canEdit}
        />
      }
    />
  )
}

function VehicleView({ vehicle }: { vehicle: VehicleResponse }) {
  return (
    <FieldGrid>
      <FieldRow label="Registration number" value={vehicle.plate_number} mono />
      <FieldRow label="Status" value={STATUS_LABELS[vehicle.status]} />
      <FieldRow label="Make" value={vehicle.make} />
      <FieldRow label="Model" value={vehicle.model} />
      <FieldRow label="Year" value={vehicle.year != null ? String(vehicle.year) : undefined} />
      <FieldRow label="Color" value={vehicle.color} />
      <FieldRow label="Chassis number" value={vehicle.chassis_number} mono />
      <FieldRow label="Engine number" value={vehicle.engine_number} mono />
      <FieldRow label="Market value" value={money(vehicle.market_value)} />
      <FieldRow label="Purchase cost" value={money(vehicle.purchase_cost)} />
    </FieldGrid>
  )
}

// --------------------------------------------------
// Create + link a collateral vehicle (when none is attached yet)
// --------------------------------------------------

function VehicleCreateForm({
  loanId,
  onDone,
  highlight,
}: {
  loanId: string
  onDone: () => void
  highlight?: Set<string>
}) {
  const createVehicle = useCreateVehicle()
  const linkVehicle = useUpdateLoan(loanId)

  const schema = useMemo(() => {
    const maxYear = new Date().getFullYear() + 1
    const money0 = (s: string) =>
      s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)
    return z.object({
      plate_number: z.string().trim().regex(VEHICLE_PLATE_RE, 'Enter a valid plate (e.g. TN09AB1234)'),
      make: z.string().trim().min(1, 'Make is required').max(50),
      model: z.string().trim().min(1, 'Model is required').max(50),
      year: z
        .string()
        .refine(
          (s) => Number.isInteger(Number(s)) && Number(s) >= 1900 && Number(s) <= maxYear,
          `Year must be between 1900 and ${maxYear}`,
        ),
      color: z.string().max(30),
      chassis_number: z.string().max(50),
      engine_number: z.string().max(50),
      market_value: z.string().refine(money0, 'Enter a valid amount'),
      purchase_cost: z.string().refine(money0, 'Enter a valid amount'),
      status: AssetStatus,
    })
  }, [])

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      plate_number: '',
      make: '',
      model: '',
      year: '',
      color: '',
      chassis_number: '',
      engine_number: '',
      market_value: '',
      purchase_cost: '',
      status: 'WITH_CUSTOMER',
    },
  })

  const onSubmit = (v: VehicleFormValues) => {
    const trimOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
    const moneyOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim())
    createVehicle.mutate(
      {
        type: 'COLLATERAL',
        status: v.status,
        plate_number: v.plate_number.trim().toUpperCase(),
        make: v.make.trim(),
        model: v.model.trim(),
        year: Number(v.year),
        color: trimOrNull(v.color),
        chassis_number: trimOrNull(v.chassis_number),
        engine_number: trimOrNull(v.engine_number),
        market_value: moneyOrUndef(v.market_value),
        purchase_cost: moneyOrUndef(v.purchase_cost),
      },
      {
        onSuccess: (vehicle) => {
          linkVehicle.mutate({ vehicle_id: vehicle.id }, { onSuccess: () => onDone() })
        },
      },
    )
  }

  const error = createVehicle.isError
    ? mapErr(createVehicle.error, 'Could not create the vehicle.')
    : linkVehicle.isError
      ? mapErr(linkVehicle.error, 'Vehicle created, but could not attach it to the finance.')
      : null
  const pending = createVehicle.isPending || linkVehicle.isPending

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <Input id="vehc_plate" label="Registration number" required placeholder="e.g. TN09AB1234" highlight={highlight?.has('plate_number')} {...register('plate_number')} error={errors.plate_number?.message} />
        <TwoCol>
          <Input id="vehc_make" label="Make" required highlight={highlight?.has('make')} {...register('make')} error={errors.make?.message} />
          <Input id="vehc_model" label="Model" required highlight={highlight?.has('model')} {...register('model')} error={errors.model?.message} />
        </TwoCol>
        <TwoCol>
          <Input id="vehc_year" label="Year" required inputMode="numeric" placeholder="e.g. 2022" highlight={highlight?.has('year')} {...register('year')} error={errors.year?.message} />
          <Input id="vehc_color" label="Color" placeholder="Optional" {...register('color')} error={errors.color?.message} />
        </TwoCol>
        <TwoCol>
          <Input id="vehc_chassis" label="Chassis number" placeholder="Optional" {...register('chassis_number')} error={errors.chassis_number?.message} />
          <Input id="vehc_engine" label="Engine number" placeholder="Optional" {...register('engine_number')} error={errors.engine_number?.message} />
        </TwoCol>
        <TwoCol>
          <Input id="vehc_market" label="Market value" inputMode="decimal" placeholder="Optional" {...register('market_value')} error={errors.market_value?.message} />
          <Input id="vehc_cost" label="Purchase cost" inputMode="decimal" placeholder="Optional" {...register('purchase_cost')} error={errors.purchase_cost?.message} />
        </TwoCol>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Input
              id="vehc_status"
              label="Status"
              select
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.status?.message}
            >
              {AssetStatus.options.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </Input>
          )}
        />
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={pending}>
            Save vehicle
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

// --------------------------------------------------
// Edit form
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

function VehicleEditForm({
  vehicle,
  onDone,
  highlight,
}: {
  vehicle: VehicleResponse
  onDone: () => void
  highlight?: Set<string>
}) {
  const update = useUpdateVehicle(vehicle.id)

  const schema = useMemo(() => {
    const maxYear = new Date().getFullYear() + 1
    const money0 = (s: string) =>
      s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)
    return z.object({
      plate_number: z
        .string()
        .trim()
        .regex(VEHICLE_PLATE_RE, 'Enter a valid plate (e.g. TN09AB1234)'),
      make: z.string().trim().max(50),
      model: z.string().trim().max(50),
      year: z
        .string()
        .refine(
          (s) =>
            s.trim() === '' ||
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
  }, [])

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      plate_number: vehicle.plate_number,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      year: vehicle.year != null ? String(vehicle.year) : '',
      color: vehicle.color ?? '',
      chassis_number: vehicle.chassis_number ?? '',
      engine_number: vehicle.engine_number ?? '',
      market_value: vehicle.market_value,
      purchase_cost: vehicle.purchase_cost,
      status: vehicle.status,
    },
  })

  const onSubmit = (v: VehicleFormValues) => {
    const payload = buildDiff(v, vehicle)
    if (Object.keys(payload).length === 0) {
      onDone()
      return
    }
    update.mutate(payload, { onSuccess: () => onDone() })
  }

  const error = update.isError ? mapErr(update.error, 'Could not save the vehicle.') : null

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
          highlight={highlight?.has('plate_number')}
          {...register('plate_number')}
          error={errors.plate_number?.message}
        />
        <TwoCol>
          <Input id="veh_make" label="Make" highlight={highlight?.has('make')} {...register('make')} error={errors.make?.message} />
          <Input id="veh_model" label="Model" highlight={highlight?.has('model')} {...register('model')} error={errors.model?.message} />
        </TwoCol>
        <TwoCol>
          <Input
            id="veh_year"
            label="Year"
            inputMode="numeric"
            highlight={highlight?.has('year')}
            {...register('year')}
            error={errors.year?.message}
          />
          <Input id="veh_color" label="Color" {...register('color')} error={errors.color?.message} />
        </TwoCol>
        <TwoCol>
          <Input
            id="veh_chassis"
            label="Chassis number"
            {...register('chassis_number')}
            error={errors.chassis_number?.message}
          />
          <Input
            id="veh_engine"
            label="Engine number"
            {...register('engine_number')}
            error={errors.engine_number?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id="veh_market"
            label="Market value"
            inputMode="decimal"
            {...register('market_value')}
            error={errors.market_value?.message}
          />
          <Input
            id="veh_cost"
            label="Purchase cost"
            inputMode="decimal"
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
              {AssetStatus.options.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </Input>
          )}
        />

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onDone} disabled={update.isPending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={update.isPending}>
            Save vehicle
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

// Only changed fields. Money/year compared numerically; nullable text fields
// clear to null when emptied.
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
  if (textOrNull(v.chassis_number) !== vehicle.chassis_number) {
    p.chassis_number = textOrNull(v.chassis_number)
  }
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

// --------------------------------------------------
// Documents — RC, insurance, photos. Replace is gated by `canEdit`; everyone
// else sees read-only View rows.
// --------------------------------------------------

function VehicleDocs({
  vehicleId,
  customerId,
  canEdit,
}: {
  vehicleId: string
  customerId: string
  canEdit: boolean
}) {
  const docsQuery = useDocuments({ vehicle_id: vehicleId, page_size: 100 })
  const del = useDeleteDocument()

  const docs = docsQuery.data?.results ?? []
  const rc = docs.find((d) => d.doc_type === 'RC_COPY') ?? null
  const insurance = docs.find((d) => d.doc_type === 'INSURANCE_POLICY') ?? null
  const photos = docs.filter((d) => d.doc_type === 'VEHICLE_PHOTO')

  // On replace, retire the previous record of the same type so the section
  // doesn't accumulate stale duplicates.
  const replaced = (prev: DocumentResponse | null) => (next: DocumentResponse) => {
    if (prev && prev.id !== next.id) del.mutate(prev.id)
  }

  return (
    <Collapsible
      title="Vehicle documents"
      subtitle={docs.length > 0 ? `${docs.length} on file` : 'None on file'}
    >
      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Spinner size={20} />
        </Box>
      ) : canEdit ? (
        <Stack spacing={2.5}>
          <FileUpload
            label="RC copy"
            customerId={customerId}
            vehicleId={vehicleId}
            docType="RC_COPY"
            initialDocument={rc}
            onUploaded={replaced(rc)}
          />
          <FileUpload
            label="Insurance policy"
            customerId={customerId}
            vehicleId={vehicleId}
            docType="INSURANCE_POLICY"
            initialDocument={insurance}
            onUploaded={replaced(insurance)}
          />
          <Box>
            <FieldLabel>Vehicle photos</FieldLabel>
            {photos.length > 0 && (
              <Stack spacing={1} sx={{ mb: 1.5 }}>
                {photos.map((p) => (
                  <DocumentLine key={p.id} doc={p} />
                ))}
              </Stack>
            )}
            <FileUpload
              customerId={customerId}
              vehicleId={vehicleId}
              docType="VEHICLE_PHOTO"
              hint="Add a vehicle photo (you can add more than one)"
            />
          </Box>
        </Stack>
      ) : docs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No vehicle documents on file.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {rc && <DocumentLine doc={rc} label="RC copy" />}
          {insurance && <DocumentLine doc={insurance} label="Insurance policy" />}
          {photos.map((p) => (
            <DocumentLine key={p.id} doc={p} label="Vehicle photo" />
          ))}
        </Stack>
      )}
    </Collapsible>
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}
