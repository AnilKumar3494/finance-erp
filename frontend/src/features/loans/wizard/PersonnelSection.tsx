import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AxiosError } from 'axios'
import { z } from 'zod'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import PersonIcon from '@mui/icons-material/PersonOutlineOutlined'

import {
  useLoanPersonnel,
  useCreatePersonnel,
  useAddPersonnelToLoan,
  useRemovePersonnelFromLoan,
  type LoanPersonnelResponse,
} from '@/api/queries/personnel'
import {
  usePersonnelIdentityProofs,
  useCreateIdentityProof,
} from '@/api/queries/identityProofs'
import type { DocumentResponse } from '@/api/queries/documents'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { FindExistingPerson } from '@/features/loans/components/FindExistingPerson'
import { AADHAAR_RE, MOBILE_RE, PAN_RE } from '@/schemas/primitives'
import { useReportDirty } from '@/features/loans/wizard/wizardGuard'
import { IdentityProofType, type PersonnelRole } from '@/schemas/enums'

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
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

export function PersonnelSection({
  financeId,
  customerId,
}: {
  financeId: string
  customerId: string
}) {
  const query = useLoanPersonnel(financeId)

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (query.isError) {
    return <ErrorBanner message="Could not load personnel for this finance." />
  }

  const links = query.data?.results ?? []
  const guarantors = links.filter((l) => l.role === 'GUARANTOR')
  const coHirers = links.filter((l) => l.role === 'CO_HIRER')

  return (
    <Stack spacing={3}>
      <RoleBlock
        financeId={financeId}
        customerId={customerId}
        role="GUARANTOR"
        title="Guarantor"
        requiredLabel
        links={guarantors}
      />
      <RoleBlock
        financeId={financeId}
        customerId={customerId}
        role="CO_HIRER"
        title="Co-hirer"
        links={coHirers}
      />
    </Stack>
  )
}

function RoleBlock({
  financeId,
  customerId,
  role,
  title,
  requiredLabel = false,
  links,
}: {
  financeId: string
  customerId: string
  role: PersonnelRole
  title: string
  requiredLabel?: boolean
  links: LoanPersonnelResponse[]
}) {
  const [addMode, setAddMode] = useState<'find' | 'new' | null>(null)

  return (
    <Card>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'baseline' }}>
        <Typography variant="h3">{title}</Typography>
        {requiredLabel && (
          <Typography component="span" sx={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
            (required)
          </Typography>
        )}
      </Stack>

      {links.length > 0 && (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {links.map((link) => (
            <PersonnelCard key={link.id} financeId={financeId} customerId={customerId} link={link} />
          ))}
        </Stack>
      )}

      {addMode === 'find' ? (
        <FindExistingPerson
          loanId={financeId}
          role={role}
          onLinked={() => setAddMode(null)}
          onCancel={() => setAddMode(null)}
        />
      ) : addMode === 'new' ? (
        <AddPersonnelForm
          financeId={financeId}
          customerId={customerId}
          role={role}
          onDone={() => setAddMode(null)}
          onCancel={() => setAddMode(null)}
        />
      ) : (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Btn variant="ghost" startIcon={<PersonIcon />} onClick={() => setAddMode('find')}>
            Find existing {title.toLowerCase()}
          </Btn>
          <Btn variant="ghost" startIcon={<PersonIcon />} onClick={() => setAddMode('new')}>
            Add new {title.toLowerCase()}
          </Btn>
        </Stack>
      )}
    </Card>
  )
}

// --------------------------------------------------
// Linked-personnel card: summary + remove + ID documents
// --------------------------------------------------

function PersonnelCard({
  financeId,
  customerId,
  link,
}: {
  financeId: string
  customerId: string
  link: LoanPersonnelResponse
}) {
  const remove = useRemovePersonnelFromLoan(financeId)
  const p = link.personnel

  return (
    <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {p.full_name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
            {p.mobile_number}
          </Typography>
          {link.relationship_to_hirer && (
            <Typography variant="body2" color="text.secondary">
              {link.relationship_to_hirer}
            </Typography>
          )}
        </Box>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => remove.mutate(link.id)}
          loading={remove.isPending}
        >
          Remove
        </Btn>
      </Stack>
      {remove.isError && (
        <Box sx={{ mt: 1 }}>
          <ErrorBanner message={mapErr(remove.error, 'Could not remove this person.')} severity="error" variant="outlined" />
        </Box>
      )}
      <Box sx={{ mt: 1.5 }}>
        <PersonnelIdDocs personnelId={p.id} customerId={customerId} />
      </Box>
    </Box>
  )
}

// --------------------------------------------------
// Personnel ID documents (entity_type = personnel)
// --------------------------------------------------

function PersonnelIdDocs({ personnelId, customerId }: { personnelId: string; customerId: string }) {
  const proofsQuery = usePersonnelIdentityProofs(personnelId)
  const create = useCreateIdentityProof()
  const [proofType, setProofType] = useState<z.infer<typeof IdentityProofType>>('AADHAAR')
  const [idNumber, setIdNumber] = useState('')
  const [uploadKey, setUploadKey] = useState(0)

  const proofs = proofsQuery.data?.results ?? []

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        ID documents
      </Typography>
      {proofs.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 0.5, mb: 1 }}>
          {proofs.map((pr) => (
            <Typography key={pr.id} variant="body2" color="text.secondary">
              • {IDENTITY_LABELS[pr.proof_type]}
              {pr.document?.file_name ? ` — ${pr.document.file_name}` : ''}
            </Typography>
          ))}
        </Stack>
      )}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
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
      </Stack>
    </Box>
  )
}

// --------------------------------------------------
// Add a new person + link to the loan
// --------------------------------------------------

interface AddFormValues {
  full_name: string
  mobile_number: string
  relationship_to_hirer: string
  aadhaar_number: string
  pan_number: string
  address_line_1: string
}

function AddPersonnelForm({
  financeId,
  customerId,
  role,
  onDone,
  onCancel,
}: {
  financeId: string
  customerId: string
  role: PersonnelRole
  onDone: () => void
  onCancel: () => void
}) {
  const createPerson = useCreatePersonnel()
  const link = useAddPersonnelToLoan(financeId)
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
        pan_number: z
          .string()
          .refine((v) => v === '' || PAN_RE.test(v.toUpperCase()), 'PAN must be AAAAA9999A'),
        address_line_1: z.string().max(500),
      }),
    [],
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<AddFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: '',
      mobile_number: '',
      relationship_to_hirer: '',
      aadhaar_number: '',
      pan_number: '',
      address_line_1: '',
    },
  })

  // The form is created (and then closed) on submit; stop reporting dirty once
  // the person has been created so the unsaved-changes guard doesn't fire.
  useReportDirty(isDirty && !createPerson.isSuccess)

  const onSubmit = (v: AddFormValues) => {
    const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
    createPerson.mutate(
      {
        full_name: v.full_name.trim(),
        mobile_number: v.mobile_number.trim(),
        aadhaar_number: orNull(v.aadhaar_number),
        pan_number: v.pan_number.trim() ? v.pan_number.trim().toUpperCase() : null,
        address_line_1: orNull(v.address_line_1),
      },
      {
        onSuccess: (person) => {
          link.mutate(
            {
              personnel_id: person.id,
              role,
              relationship_to_hirer: orNull(v.relationship_to_hirer),
            },
            {
              onSuccess: () => {
                // Link the documents uploaded in this form to the new person.
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
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
          <Input id="pn_name" label="Full name" required {...register('full_name')} error={errors.full_name?.message} />
          <Input
            id="pn_mobile"
            label="Mobile number"
            required
            inputMode="numeric"
            {...register('mobile_number')}
            error={errors.mobile_number?.message}
          />
        </Box>
        <Input
          id="pn_rel"
          label="Relationship to hirer"
          placeholder="Optional, e.g. Brother"
          {...register('relationship_to_hirer')}
          error={errors.relationship_to_hirer?.message}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
          <Input
            id="pn_aadhaar"
            label="Aadhaar number"
            placeholder="Optional"
            inputMode="numeric"
            {...register('aadhaar_number')}
            error={errors.aadhaar_number?.message}
          />
          <Input id="pn_pan" label="PAN" placeholder="Optional" {...register('pan_number')} error={errors.pan_number?.message} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
          <FileUpload
            label="Aadhaar document"
            customerId={customerId}
            docType="IDENTITY_PROOF"
            initialDocument={aadhaarDoc}
            onUploaded={setAadhaarDoc}
          />
          <FileUpload
            label="PAN document"
            customerId={customerId}
            docType="IDENTITY_PROOF"
            initialDocument={panDoc}
            onUploaded={setPanDoc}
          />
        </Box>
        <Input
          id="pn_addr"
          label="Address line 1"
          placeholder="Optional"
          {...register('address_line_1')}
          error={errors.address_line_1?.message}
        />
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onCancel} disabled={pending}>
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
