import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import PersonIcon from '@mui/icons-material/PersonOutlineOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import type { LoanResponse } from '@/api/queries/loans'
import {
  useLoanPersonnel,
  useCreatePersonnel,
  useAddPersonnelToLoan,
  useRemovePersonnelFromLoan,
  useUnmaskPersonnelPII,
  useUpdatePersonnel,
  useUpdateLoanPersonnel,
  type LoanPersonnelResponse,
  type PersonnelResponse,
  type PersonnelUpdate,
} from '@/api/queries/personnel'
import {
  usePersonnelIdentityProofs,
  useCreateIdentityProof,
} from '@/api/queries/identityProofs'
import { useDocumentDownloadUrl, type DocumentResponse } from '@/api/queries/documents'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { fmtDate } from '@/lib/format'
import { AADHAAR_RE, MOBILE_RE, PAN_RE, PIN_RE } from '@/schemas/primitives'
import { IdentityProofType, type PersonnelRole } from '@/schemas/enums'
import { FieldGrid, FieldRow } from '../components/DetailFields'
import { Collapsible } from '../components/Collapsible'
import { RevealPii } from '../components/RevealPii'
import type { SectionPermission } from '../financePermissions'

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
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (error.response?.status === 409) return detail ?? 'A person with this mobile already exists.'
    if (error.response?.status === 403) return detail ?? 'You do not have permission for this action.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function PersonnelInfoSection({
  loan,
  perm,
}: {
  loan: LoanResponse
  perm: SectionPermission
}) {
  const query = useLoanPersonnel(loan.id)
  const links = query.data?.results ?? []
  const guarantors = links.filter((l) => l.role === 'GUARANTOR')
  const coHirers = links.filter((l) => l.role === 'CO_HIRER')

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Personnel
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Guarantors and co-hirers attached to this finance.
      </Typography>

      {perm.canEdit && perm.warning && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="warning" variant="outlined" message={perm.warning} />
        </Box>
      )}

      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message="Could not load personnel for this finance." />
      ) : (
        <Stack spacing={3}>
          <RoleBlock
            loanId={loan.id}
            customerId={loan.customer_id}
            role="GUARANTOR"
            title="Guarantor"
            requiredLabel
            links={guarantors}
            canEdit={perm.canEdit}
          />
          <RoleBlock
            loanId={loan.id}
            customerId={loan.customer_id}
            role="CO_HIRER"
            title="Co-hirer"
            links={coHirers}
            canEdit={perm.canEdit}
          />
        </Stack>
      )}
    </Card>
  )
}

function RoleBlock({
  loanId,
  customerId,
  role,
  title,
  requiredLabel = false,
  links,
  canEdit,
}: {
  loanId: string
  customerId: string
  role: PersonnelRole
  title: string
  requiredLabel?: boolean
  links: LoanPersonnelResponse[]
  canEdit: boolean
}) {
  const [adding, setAdding] = useState(false)

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'baseline' }}>
        <Typography variant="h3" sx={{ fontSize: 15 }}>
          {title}
        </Typography>
        {requiredLabel && (
          <Typography component="span" sx={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
            (required)
          </Typography>
        )}
      </Stack>

      {links.length > 0 ? (
        <Stack spacing={2} sx={{ mb: canEdit ? 2 : 0 }}>
          {links.map((link) => (
            <PersonnelPersonCard
              key={link.id}
              loanId={loanId}
              customerId={customerId}
              link={link}
              canEdit={canEdit}
            />
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: canEdit ? 2 : 0 }}>
          No {title.toLowerCase()} linked.
        </Typography>
      )}

      {canEdit &&
        (adding ? (
          <AddPersonnelForm
            loanId={loanId}
            customerId={customerId}
            role={role}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Btn variant="ghost" startIcon={<PersonIcon />} onClick={() => setAdding(true)}>
            Add {title.toLowerCase()}
          </Btn>
        ))}
    </Box>
  )
}

// --------------------------------------------------
// Person card — view / inline edit + ID documents + remove
// --------------------------------------------------

function PersonnelPersonCard({
  loanId,
  customerId,
  link,
  canEdit,
}: {
  loanId: string
  customerId: string
  link: LoanPersonnelResponse
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const remove = useRemovePersonnelFromLoan(loanId)
  const p = link.personnel

  return (
    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {p.full_name}
          </Typography>
          <RelationshipEditor loanId={loanId} link={link} canEdit={canEdit} />
        </Box>
        {canEdit && !editing && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Btn variant="ghost" size="sm" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
              Edit
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => remove.mutate(link.id)} loading={remove.isPending}>
              Remove
            </Btn>
          </Stack>
        )}
      </Stack>

      {remove.isError && (
        <Box sx={{ mb: 1.5 }}>
          <ErrorBanner message={mapErr(remove.error, 'Could not remove this person.')} severity="error" variant="outlined" />
        </Box>
      )}

      {editing ? (
        <PersonnelEditForm loanId={loanId} person={p} onDone={() => setEditing(false)} />
      ) : (
        <PersonnelView person={p} />
      )}

      <Box sx={{ mt: 2 }}>
        <PersonnelIdDocs personnelId={p.id} customerId={customerId} canEdit={canEdit} />
      </Box>
    </Box>
  )
}

// Inline editor for the loan↔personnel link's relationship_to_hirer
// (PATCH /loans/{id}/personnel/{id}).
function RelationshipEditor({
  loanId,
  link,
  canEdit,
}: {
  loanId: string
  link: LoanPersonnelResponse
  canEdit: boolean
}) {
  const update = useUpdateLoanPersonnel(loanId)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(link.relationship_to_hirer ?? '')

  if (!editing) {
    if (!link.relationship_to_hirer && !canEdit) return null
    return (
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
        {link.relationship_to_hirer ? (
          <Chip size="small" label={link.relationship_to_hirer} sx={{ fontWeight: 500 }} />
        ) : (
          <Typography variant="caption" color="text.secondary">
            No relationship set
          </Typography>
        )}
        {canEdit && (
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(link.relationship_to_hirer ?? '')
              update.reset()
              setEditing(true)
            }}
          >
            {link.relationship_to_hirer ? 'Edit relationship' : 'Add relationship'}
          </Btn>
        )}
      </Stack>
    )
  }

  const save = () =>
    update.mutate(
      { loanPersonnelId: link.id, payload: { relationship_to_hirer: value.trim() || null } },
      { onSuccess: () => setEditing(false) },
    )

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Input
        id={`rel_${link.id}`}
        label="Relationship to hirer"
        placeholder="e.g. Brother"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {update.isError && (
        <ErrorBanner
          message={mapErr(update.error, 'Could not update the relationship.')}
          severity="error"
          variant="outlined"
        />
      )}
      <Stack direction="row" spacing={1}>
        <Btn variant="primary" size="sm" onClick={save} loading={update.isPending}>
          Save
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
          Cancel
        </Btn>
      </Stack>
    </Stack>
  )
}

function PersonnelView({ person }: { person: PersonnelResponse }) {
  return (
    <FieldGrid>
      <FieldRow label="Mobile" value={person.mobile_number} mono />
      <FieldRow label="Alternate mobile" value={person.alt_mobile_number} mono />
      <FieldRow label="Date of birth" value={fmtDate(person.date_of_birth) || undefined} />
      <FieldRow label="Aadhaar" value={person.aadhaar_number} mono />
      <FieldRow label="PAN" value={person.pan_number} mono />
      <FieldRow label="Address line 1" value={person.address_line_1} />
      <FieldRow label="Address line 2" value={person.address_line_2} />
      <FieldRow label="Mandal / village" value={person.mandal_village} />
      <FieldRow label="PIN code" value={person.pincode} mono />
      <FieldRow label="Remarks" value={person.remarks} />
    </FieldGrid>
  )
}

interface EditValues {
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

function PersonnelEditForm({
  loanId,
  person,
  onDone,
}: {
  loanId: string
  person: PersonnelResponse
  onDone: () => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const update = useUpdatePersonnel(loanId)
  const unmask = useUnmaskPersonnelPII()

  const schema = useMemo(
    () =>
      z.object({
        full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255),
        mobile_number: z.string().regex(MOBILE_RE, 'Enter a 10-digit mobile starting 6/7/8/9'),
        alt_mobile_number: z
          .string()
          .refine((v) => v.trim() === '' || MOBILE_RE.test(v.trim()), 'Enter a valid 10-digit mobile'),
        date_of_birth: z.custom<Dayjs | null>((v) => v === null || dayjs.isDayjs(v)),
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
  } = useForm<EditValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: person.full_name,
      mobile_number: person.mobile_number,
      alt_mobile_number: person.alt_mobile_number ?? '',
      date_of_birth: person.date_of_birth ? dayjs(person.date_of_birth) : null,
      aadhaar_number: '',
      pan_number: '',
      address_line_1: person.address_line_1 ?? '',
      address_line_2: person.address_line_2 ?? '',
      mandal_village: person.mandal_village ?? '',
      pincode: person.pincode ?? '',
      remarks: person.remarks ?? '',
    },
  })

  const onSubmit = (v: EditValues) => {
    const payload = buildDiff(v, person, isAdmin)
    if (Object.keys(payload).length === 0) {
      onDone()
      return
    }
    update.mutate({ personnelId: person.id, payload }, { onSuccess: () => onDone() })
  }

  const error = update.isError ? mapErr(update.error, 'Could not save this person.') : null

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ mt: 1 }}>
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <TwoCol>
          <Input id={`pn_name_${person.id}`} label="Full name" required {...register('full_name')} error={errors.full_name?.message} />
          <Input
            id={`pn_mobile_${person.id}`}
            label="Mobile number"
            required
            inputMode="numeric"
            {...register('mobile_number')}
            error={errors.mobile_number?.message}
          />
        </TwoCol>
        <TwoCol>
          <Input
            id={`pn_alt_${person.id}`}
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
                <FieldLabel htmlFor={`pn_dob_${person.id}`}>Date of birth</FieldLabel>
                <DatePicker
                  value={field.value}
                  onChange={(d) => field.onChange(d)}
                  format="DD MMM YYYY"
                  maxDate={dayjs()}
                  views={['year', 'month', 'day']}
                  openTo="year"
                  slotProps={{
                    textField: { id: `pn_dob_${person.id}`, size: 'small', fullWidth: true, error: !!fieldState.error },
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
                id={`pn_aadhaar_${person.id}`}
                label="Aadhaar number"
                inputMode="numeric"
                placeholder="Enter to update"
                {...register('aadhaar_number')}
                error={errors.aadhaar_number?.message}
              />
              <Input
                id={`pn_pan_${person.id}`}
                label="PAN"
                placeholder="Enter to update"
                {...register('pan_number')}
                error={errors.pan_number?.message}
              />
            </TwoCol>
            <RevealPii
              maskedAadhaar={person.aadhaar_number}
              maskedPan={person.pan_number}
              unmask={(onSuccess) => unmask.mutate(person.id, { onSuccess })}
              pending={unmask.isPending}
              error={unmask.isError ? 'Could not reveal PII. Please try again.' : null}
            />
          </>
        )}
        <Input id={`pn_addr1_${person.id}`} label="Address line 1" placeholder="Optional" {...register('address_line_1')} error={errors.address_line_1?.message} />
        <Input id={`pn_addr2_${person.id}`} label="Address line 2" placeholder="Optional" {...register('address_line_2')} error={errors.address_line_2?.message} />
        <TwoCol>
          <Input id={`pn_mandal_${person.id}`} label="Mandal / village" placeholder="Optional" {...register('mandal_village')} error={errors.mandal_village?.message} />
          <Input
            id={`pn_pin_${person.id}`}
            label="PIN code"
            inputMode="numeric"
            placeholder="Optional"
            {...register('pincode')}
            error={errors.pincode?.message}
          />
        </TwoCol>
        <Input
          id={`pn_remarks_${person.id}`}
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
            Save person
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

function buildDiff(v: EditValues, person: PersonnelResponse, isAdmin: boolean): PersonnelUpdate {
  const p: PersonnelUpdate = {}
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
  const dob = v.date_of_birth ? v.date_of_birth.format('YYYY-MM-DD') : null

  if (v.full_name.trim() !== person.full_name) p.full_name = v.full_name.trim()
  if (v.mobile_number.trim() !== person.mobile_number) p.mobile_number = v.mobile_number.trim()
  if (orNull(v.alt_mobile_number) !== person.alt_mobile_number) p.alt_mobile_number = orNull(v.alt_mobile_number)
  if (dob !== person.date_of_birth) p.date_of_birth = dob

  // Aadhaar/PAN arrive masked; only send when an admin types a new value.
  if (isAdmin) {
    if (v.aadhaar_number.trim() !== '') p.aadhaar_number = v.aadhaar_number.trim()
    if (v.pan_number.trim() !== '') p.pan_number = v.pan_number.trim().toUpperCase()
  }

  if (orNull(v.address_line_1) !== person.address_line_1) p.address_line_1 = orNull(v.address_line_1)
  if (orNull(v.address_line_2) !== person.address_line_2) p.address_line_2 = orNull(v.address_line_2)
  if (orNull(v.mandal_village) !== person.mandal_village) p.mandal_village = orNull(v.mandal_village)
  if (orNull(v.pincode) !== person.pincode) p.pincode = orNull(v.pincode)
  if (orNull(v.remarks) !== person.remarks) p.remarks = orNull(v.remarks)

  return p
}

// --------------------------------------------------
// Personnel ID documents (entity_type = personnel)
// --------------------------------------------------

function PersonnelIdDocs({
  personnelId,
  customerId,
  canEdit,
}: {
  personnelId: string
  customerId: string
  canEdit: boolean
}) {
  const proofsQuery = usePersonnelIdentityProofs(personnelId)
  const create = useCreateIdentityProof()
  const download = useDocumentDownloadUrl()
  const [proofType, setProofType] = useState<z.infer<typeof IdentityProofType>>('AADHAAR')
  const [idNumber, setIdNumber] = useState('')
  const [uploadKey, setUploadKey] = useState(0)

  const proofs = proofsQuery.data?.results ?? []

  const openDoc = (documentId: string | null) => {
    if (!documentId) return
    download.mutate(documentId, {
      onSuccess: ({ download_url }) => window.open(download_url, '_blank', 'noopener'),
    })
  }

  return (
    <Collapsible
      title="ID & other documents"
      subtitle={proofs.length > 0 ? `${proofs.length} on file` : 'None on file'}
    >
      {proofs.length > 0 ? (
        <Stack spacing={0.5} sx={{ mb: canEdit ? 1.5 : 0 }}>
          {proofs.map((pr) => (
            <Stack key={pr.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary" noWrap>
                {IDENTITY_LABELS[pr.proof_type]}
                {pr.document?.file_name ? ` — ${pr.document.file_name}` : ''}
              </Typography>
              {pr.document_id && (
                <Btn variant="ghost" size="sm" onClick={() => openDoc(pr.document_id)} loading={download.isPending}>
                  View
                </Btn>
              )}
            </Stack>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: canEdit ? 1.5 : 0 }}>
          None on file.
        </Typography>
      )}

      {canEdit && (
        <Stack spacing={1.5}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            <Input
              select
              id={`ptype_${personnelId}`}
              value={proofType}
              onChange={(e) => setProofType(e.target.value as z.infer<typeof IdentityProofType>)}
            >
              {IdentityProofType.options.map((t) => (
                <MenuItem key={t} value={t}>
                  {IDENTITY_LABELS[t]}
                </MenuItem>
              ))}
            </Input>
            <Input
              id={`pnum_${personnelId}`}
              placeholder="Document number (optional)"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
          </Box>
          <FileUpload
            key={uploadKey}
            customerId={customerId}
            docType="IDENTITY_PROOF"
            hint="Upload an ID document for this person"
            onUploaded={(doc) =>
              create.mutate(
                {
                  entity_type: 'personnel',
                  entity_id: personnelId,
                  proof_type: proofType,
                  id_number: idNumber.trim() || null,
                  document_id: doc.id,
                },
                {
                  onSuccess: () => {
                    setIdNumber('')
                    setUploadKey((k) => k + 1)
                  },
                },
              )
            }
          />
          {create.isError && (
            <ErrorBanner message={mapErr(create.error, 'Could not save this ID document.')} severity="error" variant="outlined" />
          )}
          <Typography variant="caption" color="text.secondary">
            Choose “Other” as the type to attach any additional document for this person.
          </Typography>
        </Stack>
      )}
    </Collapsible>
  )
}

// --------------------------------------------------
// Add a new person + link to the loan
// --------------------------------------------------

interface AddValues {
  full_name: string
  mobile_number: string
  relationship_to_hirer: string
  aadhaar_number: string
  pan_number: string
  address_line_1: string
  address_line_2: string
  mandal_village: string
  pincode: string
}

function AddPersonnelForm({
  loanId,
  customerId,
  role,
  onDone,
}: {
  loanId: string
  customerId: string
  role: PersonnelRole
  onDone: () => void
}) {
  const createPerson = useCreatePersonnel()
  const link = useAddPersonnelToLoan(loanId)
  const createProof = useCreateIdentityProof()
  const [aadhaarDoc, setAadhaarDoc] = useState<DocumentResponse | null>(null)
  const [panDoc, setPanDoc] = useState<DocumentResponse | null>(null)

  const schema = useMemo(
    () =>
      z.object({
        full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255),
        mobile_number: z.string().regex(MOBILE_RE, 'Enter a 10-digit mobile starting 6/7/8/9'),
        relationship_to_hirer: z.string().max(100),
        aadhaar_number: z.string().refine((v) => v === '' || AADHAAR_RE.test(v), 'Aadhaar must be 12 digits'),
        pan_number: z.string().refine((v) => v === '' || PAN_RE.test(v.toUpperCase()), 'PAN must be AAAAA9999A'),
        address_line_1: z.string().max(500),
        address_line_2: z.string().max(500),
        mandal_village: z.string().max(255),
        pincode: z
          .string()
          .refine((v) => v.trim() === '' || PIN_RE.test(v.trim()), 'PIN code must be 6 digits and cannot start with 0'),
      }),
    [],
  )

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: '',
      mobile_number: '',
      relationship_to_hirer: '',
      aadhaar_number: '',
      pan_number: '',
      address_line_1: '',
      address_line_2: '',
      mandal_village: '',
      pincode: '',
    },
  })

  const onSubmit = (v: AddValues) => {
    const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
    createPerson.mutate(
      {
        full_name: v.full_name.trim(),
        mobile_number: v.mobile_number.trim(),
        aadhaar_number: orNull(v.aadhaar_number),
        pan_number: v.pan_number.trim() ? v.pan_number.trim().toUpperCase() : null,
        address_line_1: orNull(v.address_line_1),
        address_line_2: orNull(v.address_line_2),
        mandal_village: orNull(v.mandal_village),
        pincode: orNull(v.pincode),
      },
      {
        onSuccess: (person) => {
          link.mutate(
            { personnel_id: person.id, role, relationship_to_hirer: orNull(v.relationship_to_hirer) },
            {
              onSuccess: () => {
                if (aadhaarDoc) {
                  createProof.mutate({
                    entity_type: 'personnel',
                    entity_id: person.id,
                    proof_type: 'AADHAAR',
                    id_number: orNull(v.aadhaar_number),
                    document_id: aadhaarDoc.id,
                  })
                }
                if (panDoc) {
                  createProof.mutate({
                    entity_type: 'personnel',
                    entity_id: person.id,
                    proof_type: 'PAN',
                    id_number: v.pan_number.trim() ? v.pan_number.trim().toUpperCase() : null,
                    document_id: panDoc.id,
                  })
                }
                onDone()
              },
            },
          )
        },
      },
    )
  }

  const error = createPerson.isError
    ? mapErr(createPerson.error, 'Could not create this person.')
    : link.isError
      ? mapErr(link.error, 'Person created, but could not link them to the finance.')
      : null
  const pending = createPerson.isPending || link.isPending

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}
    >
      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      <Stack spacing={2.5}>
        <TwoCol>
          <Input id="add_pn_name" label="Full name" required {...register('full_name')} error={errors.full_name?.message} />
          <Input
            id="add_pn_mobile"
            label="Mobile number"
            required
            inputMode="numeric"
            {...register('mobile_number')}
            error={errors.mobile_number?.message}
          />
        </TwoCol>
        <Input
          id="add_pn_rel"
          label="Relationship to hirer"
          placeholder="Optional, e.g. Brother"
          {...register('relationship_to_hirer')}
          error={errors.relationship_to_hirer?.message}
        />
        <TwoCol>
          <Input id="add_pn_aadhaar" label="Aadhaar number" placeholder="Optional" inputMode="numeric" {...register('aadhaar_number')} error={errors.aadhaar_number?.message} />
          <Input id="add_pn_pan" label="PAN" placeholder="Optional" {...register('pan_number')} error={errors.pan_number?.message} />
        </TwoCol>
        <TwoCol>
          <FileUpload label="Aadhaar document" customerId={customerId} docType="IDENTITY_PROOF" initialDocument={aadhaarDoc} onUploaded={setAadhaarDoc} />
          <FileUpload label="PAN document" customerId={customerId} docType="IDENTITY_PROOF" initialDocument={panDoc} onUploaded={setPanDoc} />
        </TwoCol>
        <Input id="add_pn_addr1" label="Address line 1" placeholder="Optional" {...register('address_line_1')} error={errors.address_line_1?.message} />
        <Input id="add_pn_addr2" label="Address line 2" placeholder="Optional" {...register('address_line_2')} error={errors.address_line_2?.message} />
        <TwoCol>
          <Input id="add_pn_mandal" label="Mandal / village" placeholder="Optional" {...register('mandal_village')} error={errors.mandal_village?.message} />
          <Input id="add_pn_pin" label="PIN code" inputMode="numeric" placeholder="Optional" {...register('pincode')} error={errors.pincode?.message} />
        </TwoCol>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={pending}>
            Add person
          </Btn>
        </Stack>
      </Stack>
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
