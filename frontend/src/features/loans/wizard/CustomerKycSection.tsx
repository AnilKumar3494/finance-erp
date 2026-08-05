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
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import {
  useCustomer,
  useUpdateCustomer,
  type CustomerResponse,
  type CustomerUpdate,
} from '@/api/queries/customers'
import {
  useCustomerIdentityProofs,
  useCreateIdentityProof,
  type IdentityProofResponse,
} from '@/api/queries/identityProofs'
import {
  useStabilityDocs,
  useCreateStabilityDoc,
  type StabilityDocumentResponse,
} from '@/api/queries/stabilityDocs'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { AADHAAR_RE, MOBILE_RE, PAN_RE, PIN_RE, optionalDate } from '@/schemas/primitives'
import { useReportDirty } from '@/features/loans/wizard/wizardGuard'
import { IdentityProofType, StabilityDocType } from '@/schemas/enums'

const IDENTITY_LABELS: Record<z.infer<typeof IdentityProofType>, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  DRIVING_LICENSE: 'Driving License',
  RATION_CARD: 'Ration Card',
  VOTER_ID: 'Voter ID',
  MGNREGA_CARD: 'MGNREGA Card',
  OTHER: 'Other',
}

const STABILITY_LABELS: Record<z.infer<typeof StabilityDocType>, string> = {
  PROPERTY_TAX: 'Property Tax',
  ELECTRICITY_BILL: 'Electricity Bill',
  BANK_STATEMENT: 'Bank Statement',
  CHEQUE_PDC: 'Cheque (PDC)',
  OTHER: 'Other',
}

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 409) return detail ?? 'This record already exists.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function CustomerKycSection({
  financeId,
  customerId,
}: {
  financeId: string
  customerId: string
}) {
  const customerQuery = useCustomer(customerId)

  if (customerQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (customerQuery.isError || !customerQuery.data) {
    return <ErrorBanner message="Could not load the customer for this finance." />
  }

  const customer = customerQuery.data
  return (
    <Stack spacing={3}>
      <CustomerInfoCard customer={customer} />
      <IdentityProofsCard customer={customer} />
      <StabilityDocsCard financeId={financeId} customer={customer} />
    </Stack>
  )
}

// --------------------------------------------------
// Part 1 — complete customer info (required if missing)
// --------------------------------------------------

interface InfoFormValues {
  full_name: string
  mobile_number: string
  aadhaar: string
  pan: string
  date_of_birth: Dayjs | null
  address_line_1: string
  mandal_village: string
  pincode: string
}

function CustomerInfoCard({ customer }: { customer: CustomerResponse }) {
  const update = useUpdateCustomer(customer.id)

  // Full name + mobile are NOT NULL at creation, so they are normally already
  // on file; they are validated here only for completeness. The rest may be
  // absent on a freshly created customer and are mandatory to continue.
  const missing = {
    full_name: !customer.full_name,
    mobile: !customer.mobile_number,
    aadhaar: customer.aadhaar_number == null,
    pan: customer.pan_number == null,
    dob: customer.date_of_birth == null,
    address: !customer.address_line_1,
    mandal_village: !customer.mandal_village,
    pincode: !customer.pincode,
  }

  // Identity is satisfied by EITHER Aadhaar or PAN — matching what approval
  // actually gates on (see approvalReadiness.ts). Both inputs are still
  // offered when neither is on file, but filling one is enough to continue.
  const hasIdentityOnFile = !missing.aadhaar || !missing.pan
  const needsIdentity = !hasIdentityOnFile

  const nothingMissing = !(
    missing.full_name ||
    missing.mobile ||
    needsIdentity ||
    missing.dob ||
    missing.address ||
    missing.mandal_village ||
    missing.pincode
  )

  const schema = useMemo(
    () =>
      z
        .object({
          full_name: z.string(),
          mobile_number: z.string(),
          aadhaar: z.string(),
          pan: z.string(),
          date_of_birth: optionalDate,
          address_line_1: z.string(),
          mandal_village: z.string(),
          pincode: z.string(),
        })
        .superRefine((v, ctx) => {
          if (missing.full_name && v.full_name.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['full_name'], message: 'Full name is required' })
          }
          if (missing.mobile && !MOBILE_RE.test(v.mobile_number.trim())) {
            ctx.addIssue({ code: 'custom', path: ['mobile_number'], message: 'Enter a 10-digit mobile number starting with 6, 7, 8, or 9' })
          }
          // Aadhaar / PAN: at least one, not both. Whatever IS typed still has
          // to be well-formed, so a typo never slips through as "the other one
          // will cover it".
          const aadhaarTyped = v.aadhaar.trim()
          const panTyped = v.pan.trim().toUpperCase()
          const aadhaarOk = AADHAAR_RE.test(aadhaarTyped)
          const panOk = PAN_RE.test(panTyped)

          if (missing.aadhaar && aadhaarTyped !== '' && !aadhaarOk) {
            ctx.addIssue({ code: 'custom', path: ['aadhaar'], message: 'Aadhaar must be exactly 12 digits' })
          }
          if (missing.pan && panTyped !== '' && !panOk) {
            ctx.addIssue({ code: 'custom', path: ['pan'], message: 'PAN must be in the format AAAAA9999A' })
          }
          if (needsIdentity && !aadhaarOk && !panOk) {
            ctx.addIssue({
              code: 'custom',
              path: ['aadhaar'],
              message: 'Enter either an Aadhaar number or a PAN — at least one is required',
            })
          }
          if (missing.dob && (v.date_of_birth == null || !v.date_of_birth.isValid())) {
            ctx.addIssue({ code: 'custom', path: ['date_of_birth'], message: 'Date of birth is required' })
          }
          if (missing.address && v.address_line_1.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['address_line_1'], message: 'Address is required' })
          }
          if (missing.mandal_village && v.mandal_village.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['mandal_village'], message: 'Mandal / village is required' })
          }
          if (missing.pincode && !PIN_RE.test(v.pincode.trim())) {
            ctx.addIssue({ code: 'custom', path: ['pincode'], message: 'PIN code must be 6 digits and cannot start with 0' })
          }
        }),
    [
      missing.full_name,
      missing.mobile,
      missing.aadhaar,
      missing.pan,
      needsIdentity,
      missing.dob,
      missing.address,
      missing.mandal_village,
      missing.pincode,
    ],
  )

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<InfoFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: '',
      mobile_number: '',
      aadhaar: '',
      pan: '',
      date_of_birth: null,
      address_line_1: '',
      mandal_village: '',
      pincode: '',
    },
  })

  // Once saved, the card collapses to the read-only summary, so a lingering
  // dirty flag would falsely trip the wizard's unsaved-changes guard.
  useReportDirty(isDirty && !update.isSuccess)

  const onSubmit = (v: InfoFormValues) => {
    const payload: CustomerUpdate = {}
    if (missing.full_name) payload.full_name = v.full_name.trim()
    if (missing.mobile) payload.mobile_number = v.mobile_number.trim()
    // Only send the identity field that was actually filled — an empty string
    // would fail the backend's 12-char / 10-char length validation.
    if (missing.aadhaar && v.aadhaar.trim() !== '') payload.aadhaar_number = v.aadhaar.trim()
    if (missing.pan && v.pan.trim() !== '') payload.pan_number = v.pan.trim().toUpperCase()
    if (missing.dob && v.date_of_birth) payload.date_of_birth = v.date_of_birth.format('YYYY-MM-DD')
    if (missing.address) payload.address_line_1 = v.address_line_1.trim()
    if (missing.mandal_village) payload.mandal_village = v.mandal_village.trim()
    if (missing.pincode) payload.pincode = v.pincode.trim()
    update.mutate(payload)
  }

  const saveError = update.isError ? mapErr(update.error, 'Could not save customer details.') : null

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Customer Details
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {customer.full_name} · {customer.mobile_number}
      </Typography>

      {nothingMissing || update.isSuccess ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
          <Typography variant="body2">All required customer details are on file.</Typography>
        </Stack>
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {saveError && (
            <Box sx={{ mb: 2 }}>
              <ErrorBanner message={saveError} />
            </Box>
          )}
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Some required details are missing. Please complete them to continue.
            </Typography>

            {missing.full_name && (
              <Input
                id="kyc_full_name"
                label="Full name"
                required
                {...register('full_name')}
                error={errors.full_name?.message}
              />
            )}
            {missing.mobile && (
              <Input
                id="kyc_mobile"
                label="Mobile number"
                required
                inputMode="numeric"
                placeholder="10 digits"
                {...register('mobile_number')}
                error={errors.mobile_number?.message}
              />
            )}
            {needsIdentity && (
              <Typography variant="body2" color="text.secondary">
                Provide <strong>either</strong> an Aadhaar number or a PAN — one is enough. Adding
                both is fine but not required.
              </Typography>
            )}
            {/* No per-field asterisk: the requirement is on the PAIR, not on
                either input, so marking both "required" would restate exactly
                the confusion this change removes. */}
            {missing.aadhaar && (
              <Input
                id="kyc_aadhaar"
                label="Aadhaar number"
                inputMode="numeric"
                placeholder="12 digits"
                hint={needsIdentity ? 'Enter this or a PAN below' : 'Optional'}
                {...register('aadhaar')}
                error={errors.aadhaar?.message}
              />
            )}
            {missing.pan && (
              <Input
                id="kyc_pan"
                label="PAN"
                placeholder="AAAAA9999A"
                hint={needsIdentity ? 'Enter this or the Aadhaar number above' : 'Optional'}
                {...register('pan')}
                error={errors.pan?.message}
              />
            )}
            {missing.dob && (
              <Controller
                control={control}
                name="date_of_birth"
                render={({ field, fieldState }) => (
                  <Box>
                    <FieldLabel htmlFor="kyc_dob" required>
                      Date of birth
                    </FieldLabel>
                    <DatePicker
                      value={field.value}
                      onChange={(d) => field.onChange(d)}
                      format="DD MMM YYYY"
                      maxDate={dayjs()}
                      views={['year', 'month', 'day']}
                      openTo="year"
                      slotProps={{
                        textField: { id: 'kyc_dob', size: 'small', fullWidth: true, error: !!fieldState.error },
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
            )}
            {missing.address && (
              <Input
                id="kyc_address"
                label="Address line 1"
                required
                {...register('address_line_1')}
                error={errors.address_line_1?.message}
              />
            )}
            {missing.mandal_village && (
              <Input
                id="kyc_mandal_village"
                label="Mandal / village"
                required
                {...register('mandal_village')}
                error={errors.mandal_village?.message}
              />
            )}
            {missing.pincode && (
              <Input
                id="kyc_pincode"
                label="PIN code"
                required
                inputMode="numeric"
                placeholder="6 digits"
                {...register('pincode')}
                error={errors.pincode?.message}
              />
            )}

            <Box>
              <Btn type="submit" variant="primary" loading={update.isPending}>
                Save customer details
              </Btn>
            </Box>
          </Stack>
        </Box>
      )}
    </Card>
  )
}

// --------------------------------------------------
// Part 2 — identity proof documents
// --------------------------------------------------

function IdentityProofsCard({ customer }: { customer: CustomerResponse }) {
  const proofsQuery = useCustomerIdentityProofs(customer.id)
  const byType = new Map<string, IdentityProofResponse>()
  for (const p of proofsQuery.data?.results ?? []) byType.set(p.proof_type, p)

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Identity Proof Documents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Upload a scan for each available proof. Aadhaar and PAN are recommended.
      </Typography>
      {proofsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          {IdentityProofType.options.map((t) => (
            <IdentityProofRow
              key={t}
              customerId={customer.id}
              proofType={t}
              label={IDENTITY_LABELS[t]}
              existing={byType.get(t) ?? null}
            />
          ))}
        </Stack>
      )}
    </Card>
  )
}

function IdentityProofRow({
  customerId,
  proofType,
  label,
  existing,
}: {
  customerId: string
  proofType: z.infer<typeof IdentityProofType>
  label: string
  existing: IdentityProofResponse | null
}) {
  const create = useCreateIdentityProof()
  const [idNumber, setIdNumber] = useState('')
  const done = existing !== null || create.isSuccess

  return (
    <Box sx={{ pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <FieldLabel>{label}</FieldLabel>
      {done ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
          <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
          <Typography variant="body2" color="text.secondary">
            {existing?.document?.file_name ?? existing?.id_number ?? 'Uploaded'}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Input
            id={`idnum_${proofType}`}
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
            <ErrorBanner
              message={mapErr(create.error, 'Could not save this identity proof.')}
              severity="error"
              variant="outlined"
            />
          )}
        </Stack>
      )}
    </Box>
  )
}

// --------------------------------------------------
// Part 3 — stability proof documents (loan-scoped)
// --------------------------------------------------

function StabilityDocsCard({
  financeId,
  customer,
}: {
  financeId: string
  customer: CustomerResponse
}) {
  const docsQuery = useStabilityDocs(financeId)
  const byType = new Map<string, StabilityDocumentResponse>()
  for (const d of docsQuery.data?.results ?? []) byType.set(d.doc_subtype, d)

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Stability Proof Documents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Upload any available proof of stability.
      </Typography>
      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          {StabilityDocType.options.map((t) => (
            <StabilityRow
              key={t}
              financeId={financeId}
              customerId={customer.id}
              subtype={t}
              label={STABILITY_LABELS[t]}
              existing={byType.get(t) ?? null}
            />
          ))}
        </Stack>
      )}
    </Card>
  )
}

function StabilityRow({
  financeId,
  customerId,
  subtype,
  label,
  existing,
}: {
  financeId: string
  customerId: string
  subtype: z.infer<typeof StabilityDocType>
  label: string
  existing: StabilityDocumentResponse | null
}) {
  const create = useCreateStabilityDoc(financeId)
  const [description, setDescription] = useState('')
  const [chequeCount, setChequeCount] = useState('')
  const done = existing !== null || create.isSuccess

  const needsDescription = subtype === 'OTHER'
  const needsCheque = subtype === 'CHEQUE_PDC'
  const chequeValid = !needsCheque || Number(chequeCount) >= 1
  const descriptionValid = !needsDescription || description.trim().length > 0
  const canUpload = chequeValid && descriptionValid

  return (
    <Box sx={{ pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <FieldLabel>{label}</FieldLabel>
      {done ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
          <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
          <Typography variant="body2" color="text.secondary">
            {existing?.document?.file_name ?? 'Uploaded'}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {needsCheque && (
            <Input
              id={`cheque_${subtype}`}
              label="Number of cheques"
              required
              inputMode="numeric"
              value={chequeCount}
              onChange={(e) => setChequeCount(e.target.value)}
            />
          )}
          {needsDescription && (
            <Input
              id={`desc_${subtype}`}
              label="Description"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          {canUpload ? (
            <FileUpload
              customerId={customerId}
              docType="STABILITY_DOC"
              loanId={financeId}
              onUploaded={(doc) =>
                create.mutate({
                  doc_subtype: subtype,
                  document_id: doc.id,
                  description: needsDescription ? description.trim() : null,
                  cheque_count: needsCheque ? Number(chequeCount) : null,
                })
              }
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              {needsCheque ? 'Enter the number of cheques to upload.' : 'Enter a description to upload.'}
            </Typography>
          )}
          {create.isError && (
            <ErrorBanner
              message={mapErr(create.error, 'Could not save this stability document.')}
              severity="error"
              variant="outlined"
            />
          )}
        </Stack>
      )}
    </Box>
  )
}
