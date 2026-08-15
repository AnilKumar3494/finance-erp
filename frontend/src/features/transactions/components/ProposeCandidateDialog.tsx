import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'

import { useProposeBadDebt, type BadDebtCandidateItem } from '@/api/queries/badDebt'
import { serverMessage } from '@/api/errors'
import { AxiosError } from 'axios'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { loanDisplayId } from '@/features/loans/loanIdentity'

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (detail) return detail
    if (error.response?.status === 403) return 'You do not have permission for this action.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not propose this loan. Please try again.'
}

// Propose a bad-debt candidate straight from the Candidates subtab. Keyed to a
// single candidate so the propose mutation binds to that one loan; the parent
// unmounts it (candidate=null) on close. Mirrors the per-loan ProposeAction
// dialog: a reason of at least 10 characters, then POST propose.
export function ProposeCandidateDialog({
  candidate,
  onClose,
}: {
  candidate: BadDebtCandidateItem | null
  onClose: () => void
}) {
  if (!candidate) return null
  // Key by loan so each candidate gets a fresh dialog (state seeded from its
  // own signal) rather than carrying the previous one's edits.
  return <Inner key={candidate.loan_id} candidate={candidate} onClose={onClose} />
}

// Pre-fill a sensible default reason from the candidate's own signal, which the
// admin can edit before submitting.
function defaultReason(c: BadDebtCandidateItem): string {
  return `Overdue past the penalty cap: ${c.cap_cycles} ${
    c.cap_cycles === 1 ? 'cycle' : 'cycles'
  } past cap, worst ${c.days_overdue} days overdue.`
}

function Inner({ candidate, onClose }: { candidate: BadDebtCandidateItem; onClose: () => void }) {
  const propose = useProposeBadDebt(candidate.loan_id)
  const [reason, setReason] = useState(() => defaultReason(candidate))
  const [reasonError, setReasonError] = useState<string>()

  const confirm = () => {
    const trimmed = reason.trim()
    if (trimmed.length < 10) {
      setReasonError('Give a reason of at least 10 characters')
      return
    }
    propose.mutate({ proposed_reason: trimmed }, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={propose.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Propose this loan for bad debt?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {candidate.customer_name} · {loanDisplayId(candidate)} — shortfall{' '}
          {fmtINR(Number(candidate.shortfall))}. This moves the loan to “Bad debt proposed” and
          notifies admins for review. It is logged in the audit trail.
        </Typography>
        <Input
          id="candidate_propose_reason"
          label="Reason"
          required
          multiline
          minRows={3}
          maxRows={8}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            if (e.target.value.trim().length >= 10) setReasonError(undefined)
          }}
          error={reasonError}
        />
        {propose.isError && (
          <Box sx={{ mt: 2 }}>
            <ErrorBanner message={mapError(propose.error)} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Btn variant="ghost" onClick={onClose} disabled={propose.isPending}>
          Cancel
        </Btn>
        <Btn variant="danger" onClick={confirm} loading={propose.isPending}>
          Propose bad debt
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
