import { useEffect, useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'

import {
  useReviewBadDebt,
  type BadDebtProposalListItem,
} from '@/api/queries/badDebt'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { fmtDateTime } from '@/lib/format'

function mapReviewError(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
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
export function BadDebtReviewDialog({
  proposal,
  decision,
  onClose,
  onReviewed,
}: {
  proposal: BadDebtProposalListItem | null
  decision: 'APPROVE' | 'REJECT'
  onClose: () => void
  onReviewed?: () => void
}) {
  const review = useReviewBadDebt(proposal?.loan_id ?? '')
  const [notes, setNotes] = useState('')

  // Re-seed (clear notes, drop any prior error) each time a new proposal opens.
  useEffect(() => {
    if (proposal) {
      setNotes('')
      review.reset()
    }
    // Only when the targeted proposal/decision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id, decision])

  const close = () => {
    if (review.isPending) return
    onClose()
  }

  const confirm = () => {
    if (!proposal) return
    review.mutate(
      { proposalId: proposal.id, decision, review_notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          onReviewed?.()
          onClose()
        },
      },
    )
  }

  const isApprove = decision === 'APPROVE'

  return (
    <Dialog open={proposal != null} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isApprove ? 'Approve bad-debt proposal?' : 'Reject bad-debt proposal?'}
      </DialogTitle>
      <DialogContent>
        {proposal && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2">
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Loan:{' '}
              </Box>
              <Box component="span" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                {proposal.loan_number}
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
          {isApprove
            ? 'Approving marks the loan eligible for write-off. To finalise, close the loan with a write-off. This is audited.'
            : 'Rejecting returns the loan to ACTIVE. This is audited.'}
        </Typography>
        <Input
          id="queue_review_notes"
          label="Review notes"
          multiline
          minRows={2}
          maxRows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {review.isError && (
          <Box sx={{ mt: 2 }}>
            <ErrorBanner message={mapReviewError(review.error)} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Btn variant="ghost" onClick={close} disabled={review.isPending}>
          Cancel
        </Btn>
        <Btn
          variant={isApprove ? 'success' : 'danger'}
          onClick={confirm}
          loading={review.isPending}
        >
          {isApprove ? 'Approve' : 'Reject'}
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
