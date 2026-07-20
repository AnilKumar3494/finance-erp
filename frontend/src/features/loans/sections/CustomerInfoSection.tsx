import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs, { type Dayjs } from 'dayjs'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import type { LoanResponse } from '@/api/queries/loans'
import {
  useCustomer,
  useUnmaskCustomerPII,
  useUpdateCustomer,
  type CustomerResponse,
  type CustomerUpdate,
} from '@/api/queries/customers'
import {
  useCustomerIdentityProofs,
  useCreateIdentityProof,
  useUpdateIdentityProof,
  type IdentityProofResponse,
} from '@/api/queries/identityProofs'
import { useDocumentDownloadUrl } from '@/api/queries/documents'
import { useAuth } from '@/app/auth-context'
import { Btn, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { fmtDate } from '@/lib/format'
import { AADHAAR_RE, MOBILE_RE, PAN_RE, PIN_RE } from '@/schemas/primitives'
import { IdentityProofType } from '@/schemas/enums'
import { EditableSection } from '../components/EditableSection'
import { Collapsible } from '../components/Collapsible'
import { RevealPii } from '../components/RevealPii'
import { FieldGrid, FieldRow } from '../components/DetailFields'
import type { SectionPermission } from '../financePermissions'
import type { ApprovalMissingField } from '../approvalReadiness'

const IDENTITY_LABELS: Record<z.infer<typeof IdentityProofType>, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  DRIVING_LICENSE: 'Driving License',
  RATION_CARD: 'Ration Card',
  VOTER_ID: 'Voter ID',
  MGNREGA_CARD: 'MGNREGA Card',
  OTHER: 'Other',
}

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 403) return detail ?? 'You do not have permission to edit this customer.'
    if (error.response?.status === 409) return detail ?? 'Another customer already uses these details.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function CustomerInfoSection({
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
  const customerQuery = useCustomer(loan.customer_id)
  const highlight = new Set(missing?.map((m) => m.field))

  const inner = () => {
    if (customerQuery.isLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      )
    }
    if (customerQuery.isError || !customerQuery.data) {
      return <ErrorBanner message="Could not load the customer." />
    }
    return null
  }

  const customer = customerQuery.data

  return (
    <EditableSection
      title="Customer"
      sectionId="sec-customer"
      openSignal={openSignal}
      missing={missing?.map((m) => m.label)}
      subtitle={customer ? `${customer.full_name} · ${customer.mobile_number}` : undefined}
      canEdit={perm.canEdit && !!customer}
      warning={perm.warning}
      view={inner() ?? (customer ? <CustomerView customer={customer} /> : null)}
      edit={(done) =>
        customer ? <CustomerEditForm customer={customer} onDone={done} highlight={highlight} /> : null
      }
      footer={
        customer ? (
          <CustomerDocs customerId={customer.id} canEdit={perm.canEdit} />
        ) : undefined
      }
    />
  )
}

function CustomerView({ customer }: { customer: CustomerResponse }) {
  return (
    <FieldGrid>
      <FieldRow label="Full name" value={customer.full_name} />
      <FieldRow label="Mobile number" value={customer.mobile_number} mono />
      <FieldRow label="Alternate mobile" value={customer.alt_mobile_number} mono />
      <FieldRow label="Date of birth" value={fmtDate(customer.date_of_birth) || undefined} />
      <FieldRow label="Aadhaar" value={customer.aadhaar_number} mono />
      <FieldRow label="PAN" value={customer.pan_number} mono />
      <FieldRow label="Address line 1" value={customer.address_line_1} />
      <FieldRow label="Address line 2" value={customer.address_line_2} />
      <FieldRow label="Mandal / village" value={customer.mandal_village} />
      <FieldRow label="PIN code" value={customer.pincode} mono />
      <FieldRow label="Assigned employee" value={customer.assigned_employee_name} />
      <FieldRow label="Remarks" value={customer.remarks} />
    </FieldGrid>
  )
}

// --------------------------------------------------
// Edit form — non-PII fields. Aadhaar/PAN arrive masked and are managed via
// the KYC flow, so they are intentionally not editable inline here.
// --------------------------------------------------

interface FormValues {
  full_name: string
  mobile_number: string
  alt_mobile_number: string
  date_of_birth: Dayjs | null
  aadhaar_number: string
  pan_number: string
  address_line_1: string
  address_line_2: string
  mandal_village: string
  pincode: string
  remarks: string
}

function CustomerEditForm({
  customer,
  onDone,
  highlight,
}: {
  customer: CustomerResponse
  onDone: () => void
  highlight?: Set<string>
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const update = useUpdateCustomer(customer.id)
  const unmask = useUnmaskCustomerPII()

  const schema = useMemo(
    () =>
      z
        .object({
          full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255),
          mobile_number: z.string().regex(MOBILE_RE, 'Enter a 10-digit mobile starting 6/7/8/9'),
          alt_mobile_number: z
            .string()
            .refine((v) => v.trim() === '' || MOBILE_RE.test(v.trim()), 'Enter a valid 10-digit mobile'),
          date_of_birth: z.custom<Dayjs | null>((v) => v === null || dayjs.isDayjs(v)),
          // Empty = keep current (values arrive masked); only validated when the
          // admin actually types a replacement.
          aadhaar_number: z
            .string()
            .refine((v) => v.trim() === '' || AADHAAR_RE.test(v.trim()), 'Aadhaar must be exactly 12 digits'),
          pan_number: z
            .string()
            .refine((v) => v.trim() === '' || PAN_RE.test(v.trim().toUpperCase()), 'PAN must be in the format AAAAA9999A'),
          address_line_1: z.string().max(500),
          address_line_2: z.string().max(500),
          mandal_village: z.string().max(255),
          pincode: z
            .string()
            .refine((v) => v.trim() === '' || PIN_RE.test(v.trim()), 'PIN code must be 6 digits and cannot start with 0'),
          remarks: z.string().max(1000),
        }),
    [],
  )

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: customer.full_name,
      mobile_number: customer.mobile_number,
      alt_mobile_number: customer.alt_mobile_number ?? '',
      date_of_birth: customer.date_of_birth ? dayjs(customer.date_of_birth) : null,
      aadhaar_number: '',
      pan_number: '',
      address_line_1: customer.address_line_1 ?? '',
      address_line_2: customer.address_line_2 ?? '',
      mandal_village: customer.mandal_village ?? '',
      pincode: customer.pincode ?? '',
      remarks: customer.remarks ?? '',
    },
  })

  const onSubmit = (v: FormValues) => {
    const payload = buildDiff(v, customer, isAdmin)
    if (Object.keys(payload).length === 0) {
      onDone()
      return
    }
    update.mutate(payload, { onSuccess: () => onDone() })
  }

  const error = update.isError ? mapErr(update.error, 'Could not save customer details.') : null

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <TwoCol>
          <Input id="cust_name" label="Full name" required highlight={highlight?.has('full_name')} {...register('full_name')} error={errors.full_name?.message} />
          <Input
            id="cust_mobile"
            label="Mobile number"
            required
            inputMode="numeric"
            highlight={highlight?.has('mobile_number')}
            {...register('mobile_number')}
            error={errors.mobile_number?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id="cust_alt"
            label="Alternate mobile"
            inputMode="numeric"
            placeholder="Optional"
            {...register('alt_mobile_number')}
            error={errors.alt_mobile_number?.message}
          />
          <Controller
            control={control}
            name="date_of_birth"
            render={({ field, fieldState }) => (
              <Box>
                <FieldLabel htmlFor="cust_dob">Date of birth</FieldLabel>
                <DatePicker
                  value={field.value}
                  onChange={(d) => field.onChange(d)}
                  format="DD MMM YYYY"
                  maxDate={dayjs()}
                  views={['year', 'month', 'day']}
                  openTo="year"
                  slotProps={{
                    textField: { id: 'cust_dob', size: 'small', fullWidth: true, error: !!fieldState.error },
                  }}
                />
                {fieldState.error?.message && (
                  <Typography role="alert" sx={{ mt: 0.5, fontSize: 11, fontWeight: 500, color: 'error.main' }}>
                    {fieldState.error.message}
                  </Typography>
                )}
              </Box>
            )}
          />
        </TwoCol>
        {isAdmin && (
          <>
            <TwoCol>
              <Input
                id="cust_aadhaar"
                label="Aadhaar number"
                inputMode="numeric"
                placeholder="Enter to update"
                highlight={highlight?.has('identity')}
                {...register('aadhaar_number')}
                error={errors.aadhaar_number?.message}
              />
              <Input
                id="cust_pan"
                label="PAN"
                placeholder="Enter to update"
                highlight={highlight?.has('identity')}
                {...register('pan_number')}
                error={errors.pan_number?.message}
              />
            </TwoCol>
            <RevealPii
              maskedAadhaar={customer.aadhaar_number}
              maskedPan={customer.pan_number}
              unmask={(onSuccess) => unmask.mutate(customer.id, { onSuccess })}
              pending={unmask.isPending}
              error={unmask.isError ? 'Could not reveal PII. Please try again.' : null}
            />
          </>
        )}
        <Input id="cust_addr1" label="Address line 1" placeholder="Optional" highlight={highlight?.has('address_line_1')} {...register('address_line_1')} error={errors.address_line_1?.message} />
        <Input id="cust_addr2" label="Address line 2" placeholder="Optional" {...register('address_line_2')} error={errors.address_line_2?.message} />
        <TwoCol>
          <Input id="cust_mandal" label="Mandal / village" placeholder="Optional" highlight={highlight?.has('mandal_village')} {...register('mandal_village')} error={errors.mandal_village?.message} />
          <Input
            id="cust_pin"
            label="PIN code"
            inputMode="numeric"
            placeholder="Optional"
            highlight={highlight?.has('pincode')}
            {...register('pincode')}
            error={errors.pincode?.message}
          />
        </TwoCol>
        <Input
          id="cust_remarks"
          label="Remarks"
          placeholder="Optional"
          multiline
          minRows={2}
          maxRows={6}
          {...register('remarks')}
          error={errors.remarks?.message}
        />

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onDone} disabled={update.isPending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={update.isPending}>
            Save customer
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

function buildDiff(v: FormValues, customer: CustomerResponse, isAdmin: boolean): CustomerUpdate {
  const p: CustomerUpdate = {}
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
  const dob = v.date_of_birth ? v.date_of_birth.format('YYYY-MM-DD') : null

  if (v.full_name.trim() !== customer.full_name) p.full_name = v.full_name.trim()
  if (v.mobile_number.trim() !== customer.mobile_number) p.mobile_number = v.mobile_number.trim()
  if (orNull(v.alt_mobile_number) !== customer.alt_mobile_number) p.alt_mobile_number = orNull(v.alt_mobile_number)
  if (dob !== customer.date_of_birth) p.date_of_birth = dob

  // Aadhaar/PAN arrive masked, so they are only sent when an admin types a new
  // value (empty = keep current). Never echo the masked string back.
  if (isAdmin) {
    if (v.aadhaar_number.trim() !== '') p.aadhaar_number = v.aadhaar_number.trim()
    if (v.pan_number.trim() !== '') p.pan_number = v.pan_number.trim().toUpperCase()
  }
  if (orNull(v.address_line_1) !== customer.address_line_1) p.address_line_1 = orNull(v.address_line_1)
  if (orNull(v.address_line_2) !== customer.address_line_2) p.address_line_2 = orNull(v.address_line_2)
  if (orNull(v.mandal_village) !== customer.mandal_village) p.mandal_village = orNull(v.mandal_village)
  if (orNull(v.pincode) !== customer.pincode) p.pincode = orNull(v.pincode)
  if (orNull(v.remarks) !== customer.remarks) p.remarks = orNull(v.remarks)

  return p
}

// --------------------------------------------------
// Identity proof documents — upload when missing (if permitted), view existing.
// --------------------------------------------------

function CustomerDocs({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const proofsQuery = useCustomerIdentityProofs(customerId)
  const byType = new Map<string, IdentityProofResponse>()
  for (const p of proofsQuery.data?.results ?? []) byType.set(p.proof_type, p)

  const onFileCount = byType.size

  return (
    <Collapsible
      title="Identity Proof Documents"
      subtitle={onFileCount > 0 ? `${onFileCount} on file` : 'None on file'}
    >
      {proofsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Spinner size={20} />
        </Box>
      ) : (
        <Stack spacing={2}>
          {IdentityProofType.options.map((t) => (
            <CustomerProofRow
              key={t}
              customerId={customerId}
              proofType={t}
              label={IDENTITY_LABELS[t]}
              existing={byType.get(t) ?? null}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          ))}
        </Stack>
      )}
    </Collapsible>
  )
}

function CustomerProofRow({
  customerId,
  proofType,
  label,
  existing,
  canEdit,
  isAdmin,
}: {
  customerId: string
  proofType: z.infer<typeof IdentityProofType>
  label: string
  existing: IdentityProofResponse | null
  canEdit: boolean
  isAdmin: boolean
}) {
  const create = useCreateIdentityProof()
  const updateProof = useUpdateIdentityProof()
  const download = useDocumentDownloadUrl()
  const [idNumber, setIdNumber] = useState('')
  // Prefill with the existing transcribed number (real for admins, masked for
  // others). Admins can amend it; the field is keyed to the proof so a refetch
  // re-seeds it.
  const [editNumber, setEditNumber] = useState(existing?.id_number ?? '')

  const openDoc = () => {
    if (!existing?.document_id) return
    download.mutate(existing.document_id, {
      onSuccess: ({ download_url }) => window.open(download_url, '_blank', 'noopener'),
    })
  }

  const numberChanged = editNumber.trim() !== (existing?.id_number ?? '')
  const saveNumber = () => {
    if (!existing) return
    updateProof.mutate({
      proofId: existing.id,
      payload: { id_number: editNumber.trim() || null },
    })
  }

  return (
    <Box sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <FieldLabel>{label}</FieldLabel>
      {existing ? (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {existing.document?.file_name ?? 'On file'}
            </Typography>
            {existing.document_id && (
              <Btn variant="ghost" size="sm" onClick={openDoc} loading={download.isPending}>
                View
              </Btn>
            )}
          </Stack>
          {isAdmin ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Input
                  id={`cust_idedit_${proofType}`}
                  placeholder="Document number"
                  value={editNumber}
                  onChange={(e) => setEditNumber(e.target.value)}
                />
              </Box>
              <Btn
                variant="ghost"
                size="sm"
                onClick={saveNumber}
                disabled={!numberChanged}
                loading={updateProof.isPending}
              >
                Save
              </Btn>
            </Stack>
          ) : (
            existing.id_number && (
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
                {existing.id_number}
              </Typography>
            )
          )}
          {updateProof.isError && (
            <ErrorBanner message={mapErr(updateProof.error, 'Could not update the number.')} severity="error" variant="outlined" />
          )}
        </Stack>
      ) : canEdit ? (
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Input
            id={`cust_idnum_${proofType}`}
            placeholder="Document number (optional)"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
          <FileUpload
            customerId={customerId}
            docType="IDENTITY_PROOF"
            onUploaded={(doc) =>
              create.mutate({
                entity_type: 'customer',
                entity_id: customerId,
                proof_type: proofType,
                id_number: idNumber.trim() || null,
                document_id: doc.id,
              })
            }
          />
          {create.isError && (
            <ErrorBanner message={mapErr(create.error, 'Could not save this identity proof.')} severity="error" variant="outlined" />
          )}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Not on file.
        </Typography>
      )}
    </Box>
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
      {children}
    </Box>
  )
}
