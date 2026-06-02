import { useCallback, useRef, useState, type ReactNode } from 'react'
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
import EditIcon from '@mui/icons-material/EditOutlined'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'

import {
  useCustomer,
  useDeleteCustomer,
  useUnmaskCustomerPII,
  type CustomerResponse,
  type CustomerUnmaskedPII,
} from '@/api/queries/customers'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtDateTime } from '@/lib/format'

interface CustomerDetailPageProps {
  customerId: string
}

function mapDetailError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 404) return 'Customer not found.'
    if (status === 403) return 'You do not have access to this customer.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this customer.'
}

function mapUnmaskError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 403) return 'You do not have permission to view full PII.'
    if (status === 404) return 'Customer not found.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
  }
  return 'Could not reveal PII. Please try again.'
}

function mapDeleteError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    // 409 carries the active-loan reason verbatim from the backend.
    if (status === 409) return detail ?? 'This customer cannot be archived right now.'
    if (status === 403) return 'You do not have permission to archive this customer.'
    if (status === 404) return 'Customer not found.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong archiving this customer.'
}

export function CustomerDetailPage({ customerId }: CustomerDetailPageProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const query = useCustomer(customerId)

  const canEdit = (() => {
    if (!user) return false
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true
    return query.data?.assigned_employee_id === user.id
  })()

  const canDelete = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/customers', search: { page: 1 } })}
        >
          Customers
        </Btn>
        {canEdit && (
          <Btn
            variant="ghost"
            size="sm"
            startIcon={<EditIcon />}
            onClick={() =>
              navigate({
                to: '/customers/$customerId/edit',
                params: { customerId },
              })
            }
          >
            Edit
          </Btn>
        )}
      </Stack>

      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message={mapDetailError(query.error)} />
      ) : query.data ? (
        <DetailBody customer={query.data} canDelete={canDelete} />
      ) : null}
    </Box>
  )
}

// --------------------------------------------------
// Detail body — header + 3 sections
// --------------------------------------------------

function DetailBody({
  customer,
  canDelete,
}: {
  customer: CustomerResponse
  canDelete: boolean
}) {
  return (
    <Stack spacing={3}>
      <HeaderCard customer={customer} />
      <PersonalCard customer={customer} />
      <AddressCard customer={customer} />
      <AssignmentCard customer={customer} />
      {canDelete && <DangerZoneCard customer={customer} />}
    </Stack>
  )
}

// --------------------------------------------------
// Header — name, mobile, masked PII + Reveal button
// --------------------------------------------------

function HeaderCard({ customer }: { customer: CustomerResponse }) {
  // Always render the PII row so missing values are visible as "NA". Only
  // gate the Reveal button on whether there's anything *to* unmask.
  const canReveal =
    customer.aadhaar_number !== null || customer.pan_number !== null
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revealed, setRevealed] = useState<CustomerUnmaskedPII | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const unmaskMutation = useUnmaskCustomerPII()

  const openDialog = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
      document.activeElement.blur()
    }
    unmaskMutation.reset()
    setDialogOpen(true)
  }, [unmaskMutation])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    const t = triggerRef.current
    triggerRef.current = null
    if (t) requestAnimationFrame(() => t.focus())
  }, [])

  const confirmReveal = useCallback(() => {
    unmaskMutation.mutate(customer.id, {
      onSuccess: (data) => {
        setRevealed(data)
        closeDialog()
      },
    })
  }, [closeDialog, customer.id, unmaskMutation])

  return (
    <Card>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Customer
          </Typography>
          <Typography variant="h1" sx={{ fontSize: { xs: 22, sm: 28 } }}>
            {customer.full_name}
          </Typography>
          <Typography
            variant="body1"
            sx={{ mt: 0.5, fontFamily: 'var(--font-mono)' }}
          >
            {customer.mobile_number}
          </Typography>
        </Box>

        <Divider />
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 3 }}
            sx={{ flex: 1 }}
          >
            <PIIField
              label="Aadhaar"
              value={revealed?.aadhaar_number ?? customer.aadhaar_number}
              revealed={revealed !== null}
            />
            <PIIField
              label="PAN"
              value={revealed?.pan_number ?? customer.pan_number}
              revealed={revealed !== null}
            />
          </Stack>
          {canReveal && !revealed && (
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<VisibilityIcon />}
              onClick={openDialog}
            >
              Reveal PII
            </Btn>
          )}
        </Stack>
        {unmaskMutation.isError && !dialogOpen && (
          <ErrorBanner message={mapUnmaskError(unmaskMutation.error)} />
        )}
      </Stack>

      <Dialog
        open={dialogOpen}
        onClose={unmaskMutation.isPending ? undefined : closeDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Reveal sensitive data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Showing the full Aadhaar and PAN is logged in the audit trail for
            compliance. Continue only if you have a legitimate business reason.
          </Typography>
          {unmaskMutation.isError && (
            <Box sx={{ mt: 2 }}>
              <ErrorBanner message={mapUnmaskError(unmaskMutation.error)} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn
            variant="ghost"
            onClick={closeDialog}
            disabled={unmaskMutation.isPending}
          >
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={confirmReveal}
            loading={unmaskMutation.isPending}
          >
            Reveal & log
          </Btn>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

function PIIField({
  label,
  value,
  revealed,
}: {
  label: string
  value: string | null
  revealed: boolean
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body1"
        sx={{
          fontFamily: 'var(--font-mono)',
          letterSpacing: revealed ? 0.5 : 1,
          color: value === null ? 'text.secondary' : 'text.primary',
        }}
      >
        {value ?? '—'}
      </Typography>
    </Box>
  )
}

// --------------------------------------------------
// Personal — DoB, alt mobile, remarks
// --------------------------------------------------

function PersonalCard({ customer }: { customer: CustomerResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Personal
      </Typography>
      <FieldGrid>
        <FieldRow label="Mobile" value={customer.mobile_number} mono />
        <FieldRow
          label="Alternate mobile"
          value={customer.alt_mobile_number}
          mono
        />
        <FieldRow label="Date of birth" value={fmtDate(customer.date_of_birth)} />
      </FieldGrid>
      {customer.remarks && (
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="caption" color="text.secondary">
            Remarks
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
            {customer.remarks}
          </Typography>
        </Box>
      )}
    </Card>
  )
}

// --------------------------------------------------
// Address
// --------------------------------------------------

function AddressCard({ customer }: { customer: CustomerResponse }) {
  const noAddress =
    !customer.address_line_1 &&
    !customer.address_line_2 &&
    !customer.mandal_village &&
    !customer.pincode
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Address
      </Typography>
      {noAddress ? (
        <Typography variant="body2" color="text.secondary">
          No address on file.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {customer.address_line_1 && (
            <Typography variant="body2">{customer.address_line_1}</Typography>
          )}
          {customer.address_line_2 && (
            <Typography variant="body2">{customer.address_line_2}</Typography>
          )}
          {(customer.mandal_village || customer.pincode) && (
            <Typography variant="body2">
              {customer.mandal_village ?? ''}
              {customer.mandal_village && customer.pincode ? ' · ' : ''}
              {customer.pincode ?? ''}
            </Typography>
          )}
        </Stack>
      )}
    </Card>
  )
}

// --------------------------------------------------
// Assignment + audit metadata
// --------------------------------------------------

function AssignmentCard({ customer }: { customer: CustomerResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Assignment
      </Typography>
      <FieldGrid>
        <FieldRow
          label="Assigned to"
          value={customer.assigned_employee_name ?? 'Unassigned'}
        />
        <Box />
        <FieldRow label="Created" value={fmtDateTime(customer.created_at)} />
        <FieldRow label="Last updated" value={fmtDateTime(customer.updated_at)} />
      </FieldGrid>
    </Card>
  )
}

// --------------------------------------------------
// Layout helpers
// --------------------------------------------------

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: { xs: 1.5, sm: 2.5 },
      }}
    >
      {children}
    </Box>
  )
}

// --------------------------------------------------
// Danger zone — admin-only delete
// --------------------------------------------------

function DangerZoneCard({ customer }: { customer: CustomerResponse }) {
  const navigate = useNavigate()
  const [dialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const deleteMutation = useDeleteCustomer(customer.id)

  const openDialog = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
      document.activeElement.blur()
    }
    deleteMutation.reset()
    setDialogOpen(true)
  }, [deleteMutation])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    const t = triggerRef.current
    triggerRef.current = null
    if (t) requestAnimationFrame(() => t.focus())
  }, [])

  const confirmDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        // Skip focus restore — we're navigating away.
        setDialogOpen(false)
        triggerRef.current = null
        navigate({ to: '/customers', search: { page: 1 } })
      },
    })
  }, [deleteMutation, navigate])

  return (
    <Card sx={{ borderColor: 'error.main' }}>
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h3" sx={{ color: 'error.main' }}>
            Danger zone
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Archiving removes this customer from lists and searches. Any active
            loan must be settled first.
          </Typography>
        </Box>
        <Btn variant="danger" onClick={openDialog}>
          Archive customer
        </Btn>
      </Stack>

      <Dialog
        open={dialogOpen}
        onClose={deleteMutation.isPending ? undefined : closeDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Archive {customer.full_name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This customer will no longer appear in lists or searches. The
            action is logged in the audit trail and cannot be undone from the
            UI.
          </Typography>
          {deleteMutation.isError && (
            <Box sx={{ mt: 2 }}>
              <ErrorBanner message={mapDeleteError(deleteMutation.error)} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn
            variant="ghost"
            onClick={closeDialog}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Btn>
          <Btn
            variant="danger"
            onClick={confirmDelete}
            loading={deleteMutation.isPending}
          >
            Archive
          </Btn>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const hasValue = value !== null && value !== undefined && value !== ''
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          color: hasValue ? 'text.primary' : 'text.secondary',
        }}
      >
        {hasValue ? value : '—'}
      </Typography>
    </Box>
  )
}
