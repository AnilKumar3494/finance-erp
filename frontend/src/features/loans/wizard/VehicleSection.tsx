import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useLoan, useUpdateLoan } from '@/api/queries/loans'
import { useCreateVehicle } from '@/api/queries/vehicles'
import { useDocuments } from '@/api/queries/documents'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { plateFormatWarning } from '@/schemas/primitives'
import { useReportDirty } from '@/features/loans/wizard/wizardGuard'

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 409) return detail ?? 'A vehicle with these details already exists.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function VehicleSection({
  financeId,
  customerId,
}: {
  financeId: string
  customerId: string
}) {
  const loanQuery = useLoan(financeId)

  if (loanQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (loanQuery.isError || !loanQuery.data) {
    return <ErrorBanner message="Could not load this finance." />
  }

  const loan = loanQuery.data
  if (loan.vehicle_id && loan.vehicle) {
    return (
      <Stack spacing={3}>
        <VehicleSummaryCard
          plate={loan.vehicle.plate_number}
          make={loan.vehicle.make}
          model={loan.vehicle.model}
          year={loan.vehicle.year}
        />
        <VehicleDocsCard vehicleId={loan.vehicle_id} customerId={customerId} />
      </Stack>
    )
  }
  return <VehicleCreateCard financeId={financeId} />
}

// --------------------------------------------------
// Create + link the collateral vehicle
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
}

function VehicleCreateCard({ financeId }: { financeId: string }) {
  const createVehicle = useCreateVehicle()
  const linkVehicle = useUpdateLoan(financeId)

  const schema = useMemo(() => {
    const maxYear = new Date().getFullYear() + 1
    const money = (s: string) => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)
    return z.object({
      // Registration number is required but its FORMAT is not enforced — any
      // entry is accepted (temporary "TR" plates, legacy formats). A non-standard
      // format only raises a non-blocking warning (see plateFormatWarning below).
      plate_number: z.string().trim().min(1, 'Registration number is required'),
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
      market_value: z.string().refine(money, 'Enter a valid amount'),
      purchase_cost: z.string().refine(money, 'Enter a valid amount'),
    })
  }, [])

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
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
    },
  })

  // After a successful create the card is replaced by the attached-vehicle
  // summary (once the loan refetches), so stop reporting dirty immediately.
  useReportDirty(isDirty && !createVehicle.isSuccess)

  // Advisory plate-format check — warns but never blocks (see schema).
  const plateWarning = plateFormatWarning(useWatch({ control, name: 'plate_number' }))

  const onSubmit = (v: VehicleFormValues) => {
    const trimOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
    const moneyOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim())
    createVehicle.mutate(
      {
        type: 'COLLATERAL',
        status: 'WITH_CUSTOMER',
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
          linkVehicle.mutate({ vehicle_id: vehicle.id })
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
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Vehicle (collateral)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Created as collateral, currently with the customer.
      </Typography>

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
            <Input id="veh_make" label="Make" required {...register('make')} error={errors.make?.message} />
            <Input id="veh_model" label="Model" required {...register('model')} error={errors.model?.message} />
          </TwoCol>
          <TwoCol>
            <Input
              id="veh_year"
              label="Year"
              required
              inputMode="numeric"
              placeholder="e.g. 2022"
              {...register('year')}
              error={errors.year?.message}
            />
            <Input id="veh_color" label="Color" placeholder="Optional" {...register('color')} error={errors.color?.message} />
          </TwoCol>
          <TwoCol>
            <Input
              id="veh_chassis"
              label="Chassis number"
              placeholder="Optional"
              {...register('chassis_number')}
              error={errors.chassis_number?.message}
            />
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
          <Box>
            <Btn type="submit" variant="primary" loading={pending}>
              Save vehicle
            </Btn>
          </Box>
        </Stack>
      </Box>
    </Card>
  )
}

function VehicleSummaryCard({
  plate,
  make,
  model,
  year,
}: {
  plate: string
  make: string | null
  model: string | null
  year: number | null
}) {
  return (
    <Card>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
        <Typography variant="h3">Vehicle attached</Typography>
      </Stack>
      <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)' }}>
        {plate}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {[make, model].filter(Boolean).join(' ') || '—'}
        {year ? ` · ${year}` : ''}
      </Typography>
    </Card>
  )
}

// --------------------------------------------------
// Vehicle documents — RC, insurance, photos (multiple)
// --------------------------------------------------

function VehicleDocsCard({ vehicleId, customerId }: { vehicleId: string; customerId: string }) {
  const docsQuery = useDocuments({ vehicle_id: vehicleId, page_size: 100 })
  const docs = docsQuery.data?.results ?? []
  const rc = docs.find((d) => d.doc_type === 'RC_COPY') ?? null
  const insurance = docs.find((d) => d.doc_type === 'INSURANCE_POLICY') ?? null
  const photos = docs.filter((d) => d.doc_type === 'VEHICLE_PHOTO')

  const [photoKey, setPhotoKey] = useState(0)

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Vehicle documents
      </Typography>
      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          <FileUpload
            label="RC copy"
            customerId={customerId}
            vehicleId={vehicleId}
            docType="RC_COPY"
            initialDocument={rc}
          />
          <FileUpload
            label="Insurance policy"
            customerId={customerId}
            vehicleId={vehicleId}
            docType="INSURANCE_POLICY"
            initialDocument={insurance}
          />
          <Box>
            <FieldLabel>Vehicle photos</FieldLabel>
            {photos.length > 0 && (
              <Stack spacing={1} sx={{ mb: 1.5 }}>
                {photos.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
                    <Typography variant="body2" color="text.secondary">
                      {p.file_name ?? 'Photo'}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
            <FileUpload
              key={photoKey}
              customerId={customerId}
              vehicleId={vehicleId}
              docType="VEHICLE_PHOTO"
              hint="Add a vehicle photo (you can add more than one)"
              onUploaded={() => setPhotoKey((k) => k + 1)}
            />
          </Box>
        </Stack>
      )}
    </Card>
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}
