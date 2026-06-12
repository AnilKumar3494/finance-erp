import { useCallback, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useApproveLoan, type LoanResponse } from '@/api/queries/loans'
import {
  useOpenBadDebtProposal,
  useProposeBadDebt,
  useReopenBadDebt,
  useReviewBadDebt,
} from '@/api/queries/badDebt'
import { useCustomer } from '@/api/queries/customers'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import { PaymentMethod } from '@/schemas/enums'
import { fmtDateTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '../paymentMethodLabels'
import { computeApprovalGaps, type ApprovalSectionKey } from '../approvalReadiness'
import { CloseAction } from './CloseLoanAction'

function mapActionError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 400) return detail ?? 'This action cannot be completed right now.'
    if (status === 403) return detail ?? 'You do not have permission for this action.'
    if (status === 404) return detail ?? 'Loan not found.'
    if (status === 409) return detail ?? 'This action conflicts with the loan’s current state.'
    if (status === 422) return detail ?? 'Please check the details and try again.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong. Please try again.'
}

// Focus-restore: capture the trigger, blur it (silences the aria-hidden
// warning), and restore focus on close inside a rAF (load-bearing — focus
// in the same tick gets stolen by MUI's FocusTrap unmount).
function useFocusRestore() {
  const triggerRef = useRef<HTMLElement | null>(null)
  const capture = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
      document.activeElement.blur()
    }
  }, [])
  const restore = useCallback(() => {
    const t = triggerRef.current
    triggerRef.current = null
    if (t) requestAnimationFrame(() => t.focus())
  }, [])
  return { capture, restore }
}

export function LoanActions({
  loan,
  onGuideSection,
}: {
  loan: LoanResponse
  // Jump to and open an incomplete section's editor (approval walk-through).
  onGuideSection?: (key: ApprovalSectionKey) => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const showApprove = isAdmin && loan.status === 'DRAFT'
  const showPropose = loan.status === 'ACTIVE'
  const showReview = isAdmin && loan.status === 'BAD_DEBT_PROPOSED'
  const showClose =
    isAdmin &&
    (loan.status === 'ACTIVE' ||
      loan.status === 'AWAITING_CLOSURE' ||
      loan.status === 'BAD_DEBT_PROPOSED')

  const actions = [
    showApprove && <ApproveAction key="approve" loan={loan} onGuide={onGuideSection} />,
    showReview && <ReviewAction key="review" loan={loan} />,
    showClose && <CloseAction key="close" loan={loan} />,
    showPropose && <ProposeAction key="propose" loan={loan} />,
  ].filter(Boolean)

  if (actions.length === 0) return null

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Loan actions
      </Typography>
      <Stack spacing={2} divider={<Divider flexItem />}>
        {actions}
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Approve (DRAFT -> ACTIVE)
// --------------------------------------------------

function ApproveAction({
  loan,
  onGuide,
}: {
  loan: LoanResponse
  onGuide?: (key: ApprovalSectionKey) => void
}) {
  const approve = useApproveLoan(loan.id)
  const customerQuery = useCustomer(loan.customer_id)
  const { capture, restore } = useFocusRestore()
  const [open, setOpen] = useState(false)
  const [gapsOpen, setGapsOpen] = useState(false)
  const [mode, setMode] = useState('')
  const [modeError, setModeError] = useState<string>()

  const requireMode = Number(loan.down_payment) > 0

  // Live readiness — recomputes as the admin fills sections (cache updates).
  const gaps = computeApprovalGaps(loan, customerQuery.data ?? null)
  const checking = customerQuery.isLoading

  const openDialog = () => {
    capture()
    approve.reset()
    setMode('')
    setModeError(undefined)
    setOpen(true)
  }
  const closeDialog = () => {
    setOpen(false)
    restore()
  }
  const closeGaps = () => {
    setGapsOpen(false)
    restore()
  }

  // Gate the approve flow on completeness. Incomplete → walk-through checklist;
  // complete → the confirm dialog.
  const handleApprove = () => {
    if (checking) return
    if (gaps.length > 0) {
      capture()
      setGapsOpen(true)
      return
    }
    openDialog()
  }

  const fixSection = (key: ApprovalSectionKey) => {
    // Don't restore focus to the Approve button here — it would scroll back up
    // and fight the smooth-scroll to the target section.
    setGapsOpen(false)
    onGuide?.(key)
  }

  const confirm = () => {
    if (requireMode && !PaymentMethod.safeParse(mode).success) {
      setModeError('Select how the down payment was received')
      return
    }
    approve.mutate(
      { down_payment_mode: requireMode ? (mode as PaymentMethod) : undefined },
      { onSuccess: () => closeDialog() },
    )
  }

  return (
    <Box>
      <Stack spacing={0.5} sx={{ mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Approving generates the repayment schedule and records the down payment.
          This is logged in the audit trail.
        </Typography>
        {!checking && gaps.length > 0 && (
          <Typography variant="body2" sx={{ color: 'warning.main' }}>
            {gaps.reduce((n, g) => n + g.missing.length, 0)} required detail
            {gaps.reduce((n, g) => n + g.missing.length, 0) === 1 ? '' : 's'} still needed before
            approval.
          </Typography>
        )}
      </Stack>
      <Btn variant="success" onClick={handleApprove} loading={checking}>
        Approve loan
      </Btn>

      {/* Walk-through: what's missing + jump to each section's editor. */}
      <Dialog open={gapsOpen} onClose={closeGaps} maxWidth="sm" fullWidth>
        <DialogTitle>Complete required details to approve</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This finance can’t be approved until these are filled in. Use “Fix” to jump to
            each section, complete it, then approve again.
          </Typography>
          <Stack spacing={2} divider={<Divider flexItem />}>
            {gaps.map((g) => (
              <Stack
                key={g.key}
                direction="row"
                spacing={2}
                sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {g.title}
                  </Typography>
                  <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                    {g.missing.map((m) => (
                      <Typography key={m.field} variant="body2" color="text.secondary">
                        • {m.label}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
                {onGuide && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => fixSection(g.key)}
                    sx={{ flexShrink: 0 }}
                  >
                    Fix
                  </Btn>
                )}
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Btn variant="ghost" onClick={closeGaps}>
            Close
          </Btn>
        </DialogActions>
      </Dialog>

      <Dialog
        open={open}
        onClose={approve.isPending ? undefined : closeDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Approve this loan?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: requireMode ? 2 : 0 }}>
            This sets the approval date, generates the repayment schedule
            {loan.tenure != null ? ` (${loan.tenure} cycles)` : ''}, and
            {requireMode ? ' records the down payment. ' : ' '}
            cannot be undone. The action is audited.
          </Typography>
          {requireMode && (
            <Input
              select
              id="approve_dp_mode"
              label="Down payment mode"
              required
              value={mode}
              onChange={(e) => {
                setMode(e.target.value)
                if (e.target.value) setModeError(undefined)
              }}
              error={modeError}
            >
              {PaymentMethod.options.map((m) => (
                <MenuItem key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </MenuItem>
              ))}
            </Input>
          )}
          {approve.isError && (
            <Box sx={{ mt: 2 }}>
              <ErrorBanner message={mapActionError(approve.error)} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn variant="ghost" onClick={closeDialog} disabled={approve.isPending}>
            Cancel
          </Btn>
          <Btn variant="success" onClick={confirm} loading={approve.isPending}>
            Approve &amp; generate
          </Btn>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// --------------------------------------------------
// Propose bad debt (ACTIVE -> BAD_DEBT_PROPOSED)
// --------------------------------------------------

function ProposeAction({ loan }: { loan: LoanResponse }) {
  const propose = useProposeBadDebt(loan.id)
  const { capture, restore } = useFocusRestore()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()

  const openDialog = () => {
    capture()
    propose.reset()
    setReason('')
    setReasonError(undefined)
    setOpen(true)
  }
  const closeDialog = () => {
    setOpen(false)
    restore()
  }

  const confirm = () => {
    const trimmed = reason.trim()
    if (trimmed.length < 10) {
      setReasonError('Give a reason of at least 10 characters')
      return
    }
    propose.mutate({ proposed_reason: trimmed }, { onSuccess: () => closeDialog() })
  }

  return (
    <Box>
      <Stack spacing={0.5} sx={{ mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Flag this loan for bad-debt review. An admin must approve the proposal
          before any write-off. This is logged in the audit trail.
        </Typography>
      </Stack>
      <Btn variant="danger" onClick={openDialog}>
        Propose bad debt
      </Btn>

      <Dialog
        open={open}
        onClose={propose.isPending ? undefined : closeDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Propose this loan for bad debt?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This moves the loan to “Bad debt proposed” and notifies admins for
            review. Explain why recovery is unlikely.
          </Typography>
          <Input
            id="propose_reason"
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
              <ErrorBanner message={mapActionError(propose.error)} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn variant="ghost" onClick={closeDialog} disabled={propose.isPending}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={confirm} loading={propose.isPending}>
            Propose
          </Btn>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// --------------------------------------------------
// Review proposal (admin): APPROVE keeps the loan BAD_DEBT_PROPOSED (write-off
// is then a separate Close action); REJECT returns it to ACTIVE.
// --------------------------------------------------

function ReviewAction({ loan }: { loan: LoanResponse }) {
  const proposalQuery = useOpenBadDebtProposal(loan.id, true)
  const review = useReviewBadDebt(loan.id)
  const reopen = useReopenBadDebt(loan.id)
  const { capture, restore } = useFocusRestore()
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'REOPEN' | null>(null)
  const [notes, setNotes] = useState('')

  const proposal = proposalQuery.data
  const isApproved = proposal?.status === 'APPROVED'
  const isReopen = decision === 'REOPEN'
  const mutation = isReopen ? reopen : review

  const openDialog = (d: 'APPROVE' | 'REJECT' | 'REOPEN') => {
    capture()
    review.reset()
    reopen.reset()
    setNotes('')
    setDecision(d)
  }
  const closeDialog = () => {
    setDecision(null)
    restore()
  }

  const confirm = () => {
    if (!proposal || !decision) return
    if (decision === 'REOPEN') {
      reopen.mutate(proposal.id, { onSuccess: () => closeDialog() })
      return
    }
    review.mutate(
      { proposalId: proposal.id, decision, review_notes: notes.trim() || undefined },
      { onSuccess: () => closeDialog() },
    )
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {isApproved
          ? 'This loan’s bad-debt proposal has been approved — it’s eligible for write-off. Close the loan to finalise, or reopen to undo the approval.'
          : 'This loan has an open bad-debt proposal awaiting your review.'}
      </Typography>

      {proposalQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Spinner size={22} />
        </Box>
      ) : proposal ? (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Reason {proposal.auto_proposed ? '(auto-proposed)' : ''}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
              {proposal.proposed_reason}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Proposed {fmtDateTime(proposal.proposed_at)}
            </Typography>
          </Box>
          {isApproved ? (
            <Stack direction="row">
              <Btn variant="ghost" onClick={() => openDialog('REOPEN')}>
                Reopen for review
              </Btn>
            </Stack>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Btn variant="success" onClick={() => openDialog('APPROVE')}>
                Approve proposal
              </Btn>
              <Btn variant="ghost" onClick={() => openDialog('REJECT')}>
                Reject proposal
              </Btn>
            </Stack>
          )}
        </Stack>
      ) : proposalQuery.isError ? (
        <ErrorBanner message={mapActionError(proposalQuery.error)} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          No open proposal found for this loan.
        </Typography>
      )}

      <Dialog
        open={decision !== null}
        onClose={mutation.isPending ? undefined : closeDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {decision === 'APPROVE'
            ? 'Approve bad-debt proposal?'
            : decision === 'REOPEN'
              ? 'Reopen this proposal?'
              : 'Reject bad-debt proposal?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {decision === 'APPROVE'
              ? 'Approving marks the loan eligible for write-off. To finalise, close the loan with a write-off. This is audited.'
              : decision === 'REOPEN'
                ? 'Reopening undoes the approval and puts the proposal back in the review queue (the loan stays Bad debt proposed). This is audited.'
                : 'Rejecting returns the loan to ACTIVE. This is audited.'}
          </Typography>
          {decision !== 'REOPEN' && (
            <Input
              id="review_notes"
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
              <ErrorBanner message={mapActionError(mutation.error)} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn variant="ghost" onClick={closeDialog} disabled={mutation.isPending}>
            Cancel
          </Btn>
          <Btn
            variant={decision === 'APPROVE' ? 'success' : decision === 'REOPEN' ? 'primary' : 'danger'}
            onClick={confirm}
            loading={mutation.isPending}
          >
            {decision === 'APPROVE' ? 'Approve' : decision === 'REOPEN' ? 'Reopen' : 'Reject'}
          </Btn>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
