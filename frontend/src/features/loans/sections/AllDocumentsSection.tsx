import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import UndoIcon from '@mui/icons-material/UndoOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import type { LoanResponse } from '@/api/queries/loans'
import {
  useDeleteDocument,
  useDocuments,
  useRestoreDocument,
  type DocumentResponse,
} from '@/api/queries/documents'
import { Btn, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'
import { DocCategory } from '@/schemas/enums'
import { DocumentLine } from '../components/DocumentLine'
import { Collapsible } from '../components/Collapsible'
import { CollapsibleCard } from '../components/CollapsibleCard'
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
//
// Only these two are listed because only these two can attach to a finance.
// The picker used to offer KYC, RECEIPT and the three vehicle types as well,
// but this control always sends loan_id and the backend requires KYC to be
// unlinked, RECEIPT to carry a transaction_id and vehicle docs a vehicle_id —
// so every one of them 400'd. Each already has a home elsewhere: KYC on the
// customer, receipts on the transaction, vehicle docs in Vehicle Documents.
const ADD_DOC_TYPES: DocCategory[] = ['ARCHIVE', 'LOAN_AGREEMENT']

const addDocLabel = (t: DocCategory) => (t === 'ARCHIVE' ? 'Other document' : DOC_TYPE_LABELS[t])

// How long a just-deleted row stays in place offering Restore. Deleting is a
// soft delete, so the record and its S3 object survive either way — this is
// only about how long the undo stays within reach.
const UNDO_WINDOW_MS = 6000

export function AllDocumentsSection({
  loan,
  perm,
}: {
  loan: LoanResponse
  perm: SectionPermission
}) {
  // Strictly loan-scoped: only documents attached to THIS finance (loan
  // agreements, receipts, stability proofs, ad-hoc uploads). Customer-owned
  // KYC, vehicle and personnel documents appear in their own sections, so this
  // avoids leaking another loan's documents for the same customer.
  // 100 is the endpoint's hard cap (routes/documents.py: le=100) — asking for
  // more 422s and the section renders empty.
  const docsQuery = useDocuments({ loan_id: loan.id, page_size: 100 })
  const del = useDeleteDocument()
  const restore = useRestoreDocument()
  const [showAdd, setShowAdd] = useState(false)

  // The document deleted in the last few seconds, kept in component state so
  // its row can hold its position and offer Restore. The list query drops it
  // the moment the delete lands, so the row has nowhere else to come from.
  // One at a time: deleting again closes the previous window, which is what
  // its timer was about to do anyway.
  const [undo, setUndo] = useState<{ doc: DocumentResponse; index: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const closeUndo = () => {
    clearTimeout(undoTimer.current)
    setUndo(null)
  }

  // Also filtered by id: between the DELETE resolving and the list refetch,
  // the deleted document is still in the cached page.
  const docs = (docsQuery.data?.results ?? []).filter(
    (d) => !d.is_deleted && d.id !== undo?.doc.id,
  )

  const remove = (doc: DocumentResponse, index: number) => {
    del.mutate(doc.id, {
      onSuccess: () => {
        clearTimeout(undoTimer.current)
        setUndo({ doc, index })
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
      },
    })
  }

  // Put the deleted row back where it was, so Restore appears in place of the
  // Delete button rather than the row jumping to the end of the list.
  const rows: DocumentResponse[] = [...docs]
  if (undo) rows.splice(Math.min(undo.index, rows.length), 0, undo.doc)

  return (
    <CollapsibleCard
      title="Finance Documents"
      subtitle={docs.length ? `${docs.length} on file` : undefined}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          Documents attached to this finance. KYC, vehicle and personnel docs are in their own sections.
        </Typography>
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
      ) : rows.length === 0 ? (
        // rows, not docs: deleting the last document still has to leave its
        // row on screen for the undo window.
        <Typography variant="body2" color="text.secondary">
          No documents on file yet.
        </Typography>
      ) : (
        <Collapsible title="Documents" subtitle={`${docs.length} on file`} defaultOpen>
          <Stack spacing={1.5}>
            {rows.map((doc, index) =>
              doc.id === undo?.doc.id ? (
                <DeletedDocument
                  key={doc.id}
                  doc={doc}
                  onRestore={() => restore.mutate(doc.id, { onSuccess: closeUndo })}
                  restoring={restore.isPending}
                />
              ) : perm.canEdit ? (
                <ManageableDocument
                  key={doc.id}
                  doc={doc}
                  onDelete={() => remove(doc, index)}
                  deleting={del.isPending && del.variables === doc.id}
                />
              ) : (
                <DocumentLine key={doc.id} doc={doc} label={docTypeLabel(doc.doc_type)} />
              ),
            )}
          </Stack>
        </Collapsible>
      )}
    </CollapsibleCard>
  )
}

// The row a document leaves behind for a few seconds after it is deleted —
// same footprint, Restore where Delete was. Once the window closes the row
// disappears; the document is only soft-deleted, so nothing is lost either
// way, and an admin can still restore it from the record itself.
function DeletedDocument({
  doc,
  onRestore,
  restoring,
}: {
  doc: DocumentResponse
  onRestore: () => void
  restoring: boolean
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 'var(--radius-sm)',
        bgcolor: 'var(--surface-alt)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {docTypeLabel(doc.doc_type)}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            Deleted{doc.file_name ? ` — ${doc.file_name}` : ''}
          </Typography>
        </Box>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<UndoIcon />}
          onClick={onRestore}
          loading={restoring}
          sx={{ flexShrink: 0 }}
        >
          Restore
        </Btn>
      </Stack>
    </Box>
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
  const [confirming, setConfirming] = useState(false)

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
          onClick={() => setConfirming(true)}
          loading={deleting}
        >
          Delete
        </Btn>
      </Stack>

      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontSize: 18 }}>
          <WarningAmberRoundedIcon sx={{ color: 'error.main' }} fontSize="small" />
          Delete This Document?
        </DialogTitle>
        <DialogContent sx={{ pb: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {doc.file_name ? `"${doc.file_name}" ` : 'This document '}
            will be removed from this finance. You can restore it for a few
            seconds afterwards.
          </Typography>
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
          <Btn variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              setConfirming(false)
              onDelete()
            }}
          >
            Delete
          </Btn>
        </DialogActions>
      </Dialog>

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
