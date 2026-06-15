import { useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import {
  useVehicle,
  useDeleteVehicle,
  useRestoreVehicle,
  useVehicleLoans,
  type VehicleResponse,
} from '@/api/queries/vehicles'
import { useDocuments } from '@/api/queries/documents'
import type { LoanResponse } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { fmtDateTime, fmtINR } from '@/lib/format'
import { isValidVehiclePlate } from '@/schemas/primitives'
import { EditableSection } from '@/features/loans/components/EditableSection'
import { CollapsibleCard } from '@/features/loans/components/CollapsibleCard'
import { DocumentLine } from '@/features/loans/components/DocumentLine'
import { LoanStatusChip } from '@/features/loans/components/LoanStatusChip'
import { loanDisplayId } from '@/features/loans/loanIdentity'
import { FieldGrid, FieldRow } from '@/features/loans/components/DetailFields'
import { ASSET_TYPE_LABELS, VEHICLE_STATUS_META } from '../vehicleStatusMeta'
import { VehicleStatusChip } from '../components/VehicleStatusChip'
import { VehicleForm } from '../components/VehicleForm'

interface VehicleDetailPageProps {
  vehicleId: string
}

const money = (v: string | null | undefined) =>
  v != null && v !== '' ? fmtINR(Number(v)) : undefined

function mapDetailError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 404) return 'Vehicle not found.'
    if (status === 403) return 'You do not have access to this vehicle.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this vehicle.'
}

export function VehicleDetailPage({ vehicleId }: VehicleDetailPageProps) {
  const navigate = useNavigate()
  const query = useVehicle(vehicleId)

  return (
    <Box sx={{ width: { xs: '100%', md: '80%' }, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center' }}>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/vehicles', search: { page: 1 } })}
        >
          Vehicles
        </Btn>
      </Stack>

      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message={mapDetailError(query.error)} />
      ) : query.data ? (
        <DetailBody vehicle={query.data} />
      ) : null}
    </Box>
  )
}

function DetailBody({ vehicle }: { vehicle: VehicleResponse }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const loansQuery = useVehicleLoans(vehicle.id)
  const loans = loansQuery.data?.results ?? []

  return (
    <Stack spacing={3}>
      <HeaderCard vehicle={vehicle} />

      <EditableSection
        title="Vehicle details"
        sectionId="sec-vehicle-attrs"
        subtitle={vehicle.plate_number}
        canEdit={isAdmin}
        view={<VehicleView vehicle={vehicle} />}
        edit={(done) => <VehicleForm mode="edit" vehicle={vehicle} onDone={done} />}
      />

      <AttachedLoansCard loans={loans} loading={loansQuery.isLoading} />

      <DocumentsCard vehicleId={vehicle.id} />

      {isAdmin && <DangerZone vehicle={vehicle} loans={loans} />}

      <AuditCard vehicle={vehicle} />
    </Stack>
  )
}

// --------------------------------------------------
// Header — plate, status, quick facts
// --------------------------------------------------

function HeaderCard({ vehicle }: { vehicle: VehicleResponse }) {
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'
  const plateNeedsReview = !isValidVehiclePlate(vehicle.plate_number.trim().toUpperCase())
  return (
    <Card>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1.5, sm: 2 }}
          sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Vehicle
            </Typography>
            <Typography variant="h1" sx={{ fontSize: { xs: 20, sm: 24 }, fontFamily: 'var(--font-mono)' }}>
              {vehicle.plate_number}
            </Typography>
            {plateNeedsReview && (
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ mt: 0.5, alignItems: 'center', color: 'var(--warning)' }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 14 }} />
                <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--warning)' }}>
                  Non-standard plate format — confirm or update
                </Typography>
              </Stack>
            )}
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            <VehicleStatusChip status={vehicle.status} size="medium" />
          </Box>
        </Stack>
        <Divider />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
            gap: { xs: 1.5, sm: 2.5 },
          }}
        >
          <HeaderStat label="Make / Model" value={makeModel} />
          <HeaderStat label="Year" value={vehicle.year != null ? String(vehicle.year) : '—'} />
          <HeaderStat label="Type" value={ASSET_TYPE_LABELS[vehicle.type]} />
          <HeaderStat label="Market value" value={money(vehicle.market_value) ?? '—'} />
          <HeaderStat label="Purchase cost" value={money(vehicle.purchase_cost) ?? '—'} />
        </Box>
      </Stack>
    </Card>
  )
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 16, sm: 18 } }}>
        {value}
      </Typography>
    </Box>
  )
}

// --------------------------------------------------
// Read view for the editable attributes section
// --------------------------------------------------

function VehicleView({ vehicle }: { vehicle: VehicleResponse }) {
  return (
    <FieldGrid>
      <FieldRow label="Registration number" value={vehicle.plate_number} mono />
      <FieldRow label="Status" value={VEHICLE_STATUS_META[vehicle.status].label} />
      <FieldRow label="Make" value={vehicle.make} />
      <FieldRow label="Model" value={vehicle.model} />
      <FieldRow label="Year" value={vehicle.year != null ? String(vehicle.year) : undefined} />
      <FieldRow label="Color" value={vehicle.color} />
      <FieldRow label="Chassis number" value={vehicle.chassis_number} mono />
      <FieldRow label="Engine number" value={vehicle.engine_number} mono />
      <FieldRow label="Market value" value={money(vehicle.market_value)} />
      <FieldRow label="Purchase cost" value={money(vehicle.purchase_cost)} />
      <FieldRow label="Type" value={ASSET_TYPE_LABELS[vehicle.type]} />
    </FieldGrid>
  )
}

// --------------------------------------------------
// Attached loans
// --------------------------------------------------

function AttachedLoansCard({ loans, loading }: { loans: LoanResponse[]; loading: boolean }) {
  const navigate = useNavigate()
  return (
    <CollapsibleCard title="Attached loans">
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Spinner size={20} />
        </Box>
      ) : loans.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No loans are backed by this vehicle.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {loans.map((l) => (
            <Stack
              key={l.id}
              direction="row"
              spacing={1.5}
              role="button"
              tabIndex={0}
              aria-label={`Open finance ${loanDisplayId(l)}`}
              onClick={() => navigate({ to: '/finances/$loanId', params: { loanId: l.id } })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ to: '/finances/$loanId', params: { loanId: l.id } })
                }
              }}
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                '&:hover': { borderColor: 'primary.main' },
                '&:focus-visible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {loanDisplayId(l)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {l.customer?.full_name ?? 'Unknown customer'}
                </Typography>
              </Box>
              <LoanStatusChip status={l.status} />
            </Stack>
          ))}
        </Stack>
      )}
    </CollapsibleCard>
  )
}

// --------------------------------------------------
// Documents (read-only)
// --------------------------------------------------

function DocumentsCard({ vehicleId }: { vehicleId: string }) {
  const docsQuery = useDocuments({ vehicle_id: vehicleId, page_size: 100 })
  const docs = docsQuery.data?.results ?? []
  return (
    <CollapsibleCard title="Documents">
      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Spinner size={20} />
        </Box>
      ) : docs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No documents on file for this vehicle.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {docs.map((d) => (
            <DocumentLine key={d.id} doc={d} />
          ))}
        </Stack>
      )}
    </CollapsibleCard>
  )
}

// --------------------------------------------------
// Danger zone — admin-only delete / restore
// --------------------------------------------------

const CONFIRM_WORD = 'delete'

function mapDeleteError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 400 || status === 409) return detail ?? 'This vehicle cannot be deleted right now.'
    if (status === 403) return 'You do not have permission to delete this vehicle.'
    if (status === 404) return 'Vehicle not found — it may already be deleted.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong deleting this vehicle.'
}

function mapRestoreError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (error.response?.status === 409) return detail ?? 'Could not restore this vehicle.'
  }
  return 'Something went wrong restoring this vehicle.'
}

function DangerZone({ vehicle, loans }: { vehicle: VehicleResponse; loans: LoanResponse[] }) {
  const navigate = useNavigate()
  const del = useDeleteVehicle(vehicle.id)
  const restore = useRestoreVehicle(vehicle.id)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  // After a successful delete we keep this page mounted (GET 404s on deleted
  // rows, so there's no way back to it). Flip to a "deleted" state offering
  // Restore in place.
  const [deleted, setDeleted] = useState(false)

  // A vehicle backing an ACTIVE loan can't be deleted (server enforces; we gate
  // the UI too).
  const blockingLoan = loans.find((l) => l.status === 'ACTIVE')

  const close = () => {
    if (del.isPending) return
    setOpen(false)
    setConfirm('')
  }
  const canDelete = confirm.trim().toLowerCase() === CONFIRM_WORD
  const onConfirm = () => {
    if (!canDelete) return
    del.mutate(undefined, {
      onSuccess: () => {
        setOpen(false)
        setConfirm('')
        setDeleted(true)
      },
    })
  }

  if (deleted) {
    return (
      <Card sx={{ borderColor: 'var(--danger)' }}>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h3">Vehicle deleted</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              This vehicle has been removed from lists and searches. You can restore
              it, or go back to the vehicles list.
            </Typography>
          </Box>
          {restore.isError && <ErrorBanner message={mapRestoreError(restore.error)} />}
          <Stack direction="row" spacing={2}>
            <Btn
              variant="ghost"
              onClick={() => navigate({ to: '/vehicles', search: { page: 1 } })}
              disabled={restore.isPending}
            >
              Back to list
            </Btn>
            <Btn
              variant="primary"
              loading={restore.isPending}
              onClick={() => restore.mutate(undefined, { onSuccess: () => setDeleted(false) })}
            >
              Restore vehicle
            </Btn>
          </Stack>
        </Stack>
      </Card>
    )
  }

  return (
    <Card sx={{ borderColor: 'error.main' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
        <Typography variant="h3" sx={{ color: 'error.main' }}>
          Danger zone
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Deleting removes this vehicle from lists and searches. It can be restored
        afterwards.
        {blockingLoan
          ? ' This vehicle is collateral on an active loan and cannot be deleted until that loan is settled.'
          : ''}
      </Typography>
      <Btn variant="danger" onClick={() => setOpen(true)} disabled={!!blockingLoan}>
        Delete vehicle
      </Btn>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontSize: 18 }}>
          <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
          Delete this vehicle?
        </DialogTitle>
        <DialogContent sx={{ pb: 1.5 }}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              This removes vehicle{' '}
              <Box component="span" sx={{ fontFamily: 'var(--font-mono)', color: 'text.primary' }}>
                {vehicle.plate_number}
              </Box>{' '}
              from lists and searches. You can restore it afterwards.
            </Typography>
            <Box>
              <FieldLabel htmlFor="veh_delete_confirm">
                Type <Box component="span" sx={{ fontWeight: 700 }}>delete</Box> to confirm
              </FieldLabel>
              <Input
                id="veh_delete_confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="delete"
                autoComplete="off"
                autoFocus
              />
            </Box>
            {del.isError && <ErrorBanner message={mapDeleteError(del.error)} />}
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            pb: 2.5,
            pt: 0,
            gap: 1,
            flexDirection: { xs: 'column-reverse', sm: 'row' },
            '& > :not(:first-of-type)': { ml: 0 },
            '& > button': { width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' },
          }}
        >
          <Btn variant="ghost" onClick={close} disabled={del.isPending}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={onConfirm} disabled={!canDelete} loading={del.isPending}>
            Delete vehicle
          </Btn>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

// --------------------------------------------------
// Audit
// --------------------------------------------------

function AuditCard({ vehicle }: { vehicle: VehicleResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Audit
      </Typography>
      <FieldGrid>
        <FieldRow label="Created" value={fmtDateTime(vehicle.created_at)} />
        <FieldRow label="Last updated" value={fmtDateTime(vehicle.updated_at)} />
        <FieldRow label="Created by" value={vehicle.created_by_id ?? undefined} />
        <FieldRow label="Updated by" value={vehicle.updated_by_id ?? undefined} />
      </FieldGrid>
    </Card>
  )
}
