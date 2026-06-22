import { useEffect, useState } from 'react'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'

import {
  useReviewBadDebt,
  useReopenBadDebt,
  type BadDebtProposalListItem,
} from '@/api/queries/badDebt'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { loanDisplayId } from '@/features/loans/loanIdentity'
import { fmtDateTime } from '@/lib/format'

export type BadDebtDecision = 'APPROVE' | 'REJECT' | 'REOPEN'

function mapReviewError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (detail) return detail
    if (error.response?.status === 403) return 'You do not have permission to review this proposal.'
    if (error.response?.status === 409) return 'This proposal conflicts with the loan’s current state.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not record the review. Please try again.'
}

// Inline approve/reject for a bad-debt proposal straight from the Collections
// review queue, so an admin can clear the queue without opening each loan. The
// proposal row already carries everything we need (loan_id + proposal id), so
// no per-loan fetch — unlike the per-loan ReviewAction which has to look the
// open proposal up. Always mounted; `proposal` null = closed.
const DIALOG_COPY: Record<BadDebtDecision, { title: string; blurb: string; cta: string }> = {
  APPROVE: {
    title: 'Approve bad-debt proposal?',
    blurb:
      'Approving marks the loan eligible for write-off. To finalise, close the loan with a write-off. This is audited.',
    cta: 'Approve',
  },
  REJECT: {
    title: 'Reject bad-debt proposal?',
    blurb: 'Rejecting returns the loan to ACTIVE. This is audited.',
    cta: 'Reject',
  },
  REOPEN: {
    title: 'Reopen this proposal?',
    blurb:
      'Reopening undoes the approval and puts the proposal back in the review queue (the loan stays Bad debt proposed). This is audited.',
    cta: 'Reopen',
  },
}

export function BadDebtReviewDialog({
  proposal,
  decision,
  onClose,
  onReviewed,
}: {
  proposal: BadDebtProposalListItem | null
  decision: BadDebtDecision
  onClose: () => void
  onReviewed?: () => void
}) {
  const loanId = proposal?.loan_id ?? ''
  const review = useReviewBadDebt(loanId)
  const reopen = useReopenBadDebt(loanId)
  const [notes, setNotes] = useState('')

  const isReopen = decision === 'REOPEN'
  const mutation = isReopen ? reopen : review

  // Re-seed (clear notes, drop any prior error) each time a new proposal opens.
  useEffect(() => {
    if (proposal) {
      setNotes('')
      review.reset()
      reopen.reset()
    }
    // Only when the targeted proposal/decision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id, decision])

  const close = () => {
    if (mutation.isPending) return
    onClose()
  }

  const confirm = () => {
    if (!proposal) return
    const onSuccess = () => {
      onReviewed?.()
      onClose()
    }
    if (isReopen) {
      reopen.mutate(proposal.id, { onSuccess })
    } else {
      review.mutate(
        { proposalId: proposal.id, decision, review_notes: notes.trim() || undefined },
        { onSuccess },
      )
    }
  }

  const copy = DIALOG_COPY[decision]
  const isApprove = decision === 'APPROVE'

  return (
    <Dialog open={proposal != null} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        {proposal && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2">
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Loan:{' '}
              </Box>
              <Box component="span" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                {loanDisplayId(proposal)}
              </Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {' '}
                · {proposal.customer_name}
              </Box>
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Reason {proposal.auto_proposed ? '(auto-proposed)' : ''}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                {proposal.proposed_reason}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Proposed {fmtDateTime(proposal.proposed_at)}
              </Typography>
            </Box>
          </Box>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {copy.blurb}
        </Typography>
        {/* Reopen carries no notes (the endpoint clears the prior review). */}
        {!isReopen && (
          <Input
            id="queue_review_notes"
            label="Review notes"
            multiline
            minRows={2}
            maxRows={6}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
        {mutation.isError && (
          <Box sx={{ mt: 2 }}>
            <ErrorBanner message={mapReviewError(mutation.error)} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Btn variant="ghost" onClick={close} disabled={mutation.isPending}>
          Cancel
        </Btn>
        <Btn
          variant={isApprove ? 'success' : isReopen ? 'primary' : 'danger'}
          onClick={confirm}
          loading={mutation.isPending}
        >
          {copy.cta}
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
