import { useState } from 'react'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'

import type { LoanResponse } from '@/api/queries/loans'
import {
  useDeleteDocument,
  useDocuments,
  type DocumentResponse,
} from '@/api/queries/documents'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { DocCategory } from '@/schemas/enums'
import { DocumentLine } from '../components/DocumentLine'
import { Collapsible } from '../components/Collapsible'
import type { SectionPermission } from '../financePermissions'

const DOC_TYPE_LABELS: Record<DocCategory, string> = {
  ARCHIVE: 'Archive',
  KYC: 'KYC',
  LOAN_AGREEMENT: 'Loan agreement',
  RECEIPT: 'Receipt',
  VEHICLE_IMAGE: 'Vehicle image',
  IDENTITY_PROOF: 'Identity proof',
  STABILITY_DOC: 'Stability document',
  RC_COPY: 'RC copy',
  INSURANCE_POLICY: 'Insurance policy',
  VEHICLE_PHOTO: 'Vehicle photo',
}

const docTypeLabel = (t: string) => DOC_TYPE_LABELS[t as DocCategory] ?? t

// Pickable doc types for the manual "add document" control. Identity proofs and
// stability docs are managed in their own sections (they wrap extra metadata).
// ARCHIVE is surfaced as the generic "Other" bucket for ad-hoc uploads.
const ADD_DOC_TYPES: DocCategory[] = [
  'ARCHIVE',
  'KYC',
  'LOAN_AGREEMENT',
  'RECEIPT',
  'RC_COPY',
  'INSURANCE_POLICY',
  'VEHICLE_PHOTO',
  'VEHICLE_IMAGE',
]

const addDocLabel = (t: DocCategory) => (t === 'ARCHIVE' ? 'Other document' : DOC_TYPE_LABELS[t])

export function AllDocumentsSection({
  loan,
  perm,
}: {
  loan: LoanResponse
  perm: SectionPermission
}) {
  // Every document is owned by a customer, so a customer-scoped query is the
  // broadest catch-all — it surfaces loan, vehicle, personnel and KYC documents
  // in one place.
  const docsQuery = useDocuments({ customer_id: loan.customer_id, page_size: 200 })
  const del = useDeleteDocument()
  const [showAdd, setShowAdd] = useState(false)

  const docs = (docsQuery.data?.results ?? []).filter((d) => !d.is_deleted)

  return (
    <Card>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h3">All documents</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Every document on file for this customer and finance.
          </Typography>
        </Box>
        {perm.canEdit && !showAdd && (
          <Btn variant="ghost" size="sm" onClick={() => setShowAdd(true)} sx={{ flexShrink: 0 }}>
            Add other document
          </Btn>
        )}
      </Stack>

      {perm.canEdit && perm.warning && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="warning" variant="outlined" message={perm.warning} />
        </Box>
      )}

      {perm.canEdit && showAdd && (
        <Box sx={{ mb: 3 }}>
          <AddDocument
            customerId={loan.customer_id}
            loanId={loan.id}
            onClose={() => setShowAdd(false)}
          />
        </Box>
      )}

      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      ) : docsQuery.isError ? (
        <ErrorBanner message="Could not load documents." />
      ) : docs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No documents on file yet.
        </Typography>
      ) : (
        <Collapsible title="Documents" subtitle={`${docs.length} on file`} defaultOpen>
          <Stack spacing={1.5}>
            {docs.map((doc) =>
              perm.canEdit ? (
                <ManageableDocument
                  key={doc.id}
                  doc={doc}
                  onDelete={() => del.mutate(doc.id)}
                  deleting={del.isPending && del.variables === doc.id}
                />
              ) : (
                <DocumentLine key={doc.id} doc={doc} label={docTypeLabel(doc.doc_type)} />
              ),
            )}
          </Stack>
        </Collapsible>
      )}
    </Card>
  )
}

// A document row with View / Replace (via FileUpload) plus a Delete affordance.
// Replace retires the previous record so the list doesn't accumulate duplicates.
function ManageableDocument({
  doc,
  onDelete,
  deleting,
}: {
  doc: DocumentResponse
  onDelete: () => void
  deleting: boolean
}) {
  const del = useDeleteDocument()

  return (
    <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {docTypeLabel(doc.doc_type)}
        </Typography>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<DeleteOutlineIcon />}
          onClick={onDelete}
          loading={deleting}
        >
          Delete
        </Btn>
      </Stack>
      <FileUpload
        customerId={doc.customer_id}
        docType={doc.doc_type}
        loanId={doc.loan_id ?? undefined}
        vehicleId={doc.vehicle_id ?? undefined}
        initialDocument={doc}
        onUploaded={(next) => {
          if (next.id !== doc.id) del.mutate(doc.id)
        }}
      />
    </Box>
  )
}

function AddDocument({
  customerId,
  loanId,
  onClose,
}: {
  customerId: string
  loanId: string
  onClose: () => void
}) {
  const [docType, setDocType] = useState<DocCategory>('ARCHIVE')

  return (
    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack spacing={2}>
        <Input
          select
          id="add_doc_type"
          label="Document type"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocCategory)}
        >
          {ADD_DOC_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {addDocLabel(t)}
            </MenuItem>
          ))}
        </Input>
        <FileUpload
          customerId={customerId}
          loanId={loanId}
          docType={docType}
          hint="Upload a document for this finance"
          onUploaded={onClose}
        />
        <Box>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            Done
          </Btn>
        </Box>
      </Stack>
    </Box>
  )
}
