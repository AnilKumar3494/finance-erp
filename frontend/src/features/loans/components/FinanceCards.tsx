import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

import type { LoanResponse } from '@/api/queries/loans'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { LoadMoreFooter } from '@/components/infinite/InfiniteFooter'
import { fmtDate, fmtINR } from '@/lib/format'
import { loanDisplayId } from '../loanIdentity'
import { computeApprovalGaps } from '../approvalReadiness'
import { ApproveAction } from './LoanActions'
import { LoanStatusChip } from './LoanStatusChip'
import { EmiDueChip } from './EmiDueChip'

// The card view for a filtered finances list: a box per finance instead of a
// table row, surfacing who, what vehicle and the terms at a glance. Every chip
// except "All" uses it — a filtered view is already narrowed to one kind of
// finance, so the table's repeated status column carries little signal, while
// "All" keeps the scannable table across mixed statuses.
//
// On a DRAFT the card additionally carries the Approve action and names what is
// still missing; Approve reuses the full flow (completeness gate + confirm
// dialog) and "Fix" sends the admin to the detail page. Drafts missing their due
// date or HP number DO reach the approval queue (the server filter no longer
// excludes them) precisely so the card can say what is unfilled, rather than the
// finance quietly vanishing from the list.
export function FinanceCards({
  rows,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  rows: LoanResponse[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}) {
  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
          },
          gap: 2,
        }}
      >
        {rows.map((loan) => (
          <FinanceCard key={loan.id} loan={loan} />
        ))}
      </Box>
      <InfiniteSentinel
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        count={rows.length}
      />
    </Box>
  )
}

function FinanceCard({ loan }: { loan: LoanResponse }) {
  const navigate = useNavigate()
  const goToDetail = () =>
    navigate({ to: '/finances/$loanId', params: { loanId: loan.id } })

  // Approve and the readiness warning only mean anything on a draft.
  const isDraft = loan.status === 'DRAFT'
  const blocking = isDraft
    ? computeApprovalGaps(loan, null).flatMap((g) => g.missing.map((m) => m.label))
    : []
  // Not a blocker: the approve dialog asks for the due date and requires it
  // there, so this is a heads-up about what the admin will be asked, not
  // something to go away and fix first.
  const needsDueDate = isDraft && !loan.first_emi_date

  return (
    <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* HP number + vehicle registration — the two IDs an admin scans for. */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
      >
        <Typography
          variant="h3"
          sx={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' }}
        >
          {loanDisplayId(loan)}
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'text.secondary' }}
        >
          {loan.vehicle?.plate_number ?? '—'}
        </Typography>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Created {loan.created_at ? fmtDate(loan.created_at) : '—'}
      </Typography>

      {/* A draft's status is implied by the view it sits in; every other filter
          can still mix EMI states, so carry the chips the table column had. */}
      {!isDraft && (
        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
          <LoanStatusChip status={loan.status} />
          <EmiDueChip status={loan.emi_due_status} />
        </Stack>
      )}

      <Typography variant="body1" sx={{ mt: 1, fontWeight: 600 }}>
        {loan.customer?.full_name ?? '—'}
      </Typography>
      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        <DetailLine label="Phone" value={loan.customer?.mobile_number} mono />
        <DetailLine label="Mandal/Village" value={loan.customer?.mandal_village} />
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      {/* The terms being committed on approval. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 1,
          columnGap: 1.5,
        }}
      >
        <Metric label="Principal" value={loan.principal != null ? fmtINR(Number(loan.principal)) : '—'} />
        <Metric label="Due date" value={loan.first_emi_date ? fmtDate(loan.first_emi_date) : '—'} />
        <Metric label="Tenure" value={loan.tenure != null ? `${loan.tenure} months` : '—'} />
        <Metric
          label="Interest"
          value={loan.interest_rate != null ? `${loan.interest_rate}% p.a.` : '—'}
        />
      </Box>

      {/* What still blocks approval, named on the card. Passing a null customer
          restricts this to loan-level gaps (terms + vehicle) — the customer
          section needs a full record this list response doesn't carry, and it
          is re-checked by the Approve flow itself. */}
      {blocking.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <ErrorBanner
            severity="warning"
            variant="outlined"
            message={`Missing before approval: ${blocking.join(', ')}`}
          />
        </Box>
      )}
      {needsDueDate && (
        <Box sx={{ mt: 1.5 }}>
          <ErrorBanner
            severity="info"
            variant="outlined"
            message="No due date yet — set it when you approve."
          />
        </Box>
      )}

      {/* Push the actions to the card bottom so a grid row of cards aligns. */}
      <Box sx={{ mt: 'auto', pt: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Btn
            variant={isDraft ? 'ghost' : 'outline'}
            size="sm"
            onClick={goToDetail}
            sx={{ flexShrink: 0, ...(isDraft ? null : { width: '100%' }) }}
          >
            View
          </Btn>
          {isDraft && (
            <Box sx={{ flexGrow: 1 }}>
              <ApproveAction loan={loan} compact onGuide={goToDetail} />
            </Box>
          )}
        </Stack>
      </Box>
    </Card>
  )
}

function DetailLine({
  label,
  value,
  mono = false,
}: {
  label: string
  value?: string | null
  mono?: boolean
}) {
  return (
    <Typography variant="body2">
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {label}:{' '}
      </Box>
      <Box component="span" sx={{ fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value ?? '—'}
      </Box>
    </Typography>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  )
}

// Auto-loads the next page when scrolled near the bottom. The card grid is not
// virtualized (the approval queue is small), so this replaces the virtualizer's
// built-in fetch trigger the table/mobile lists use.
function InfiniteSentinel({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  return <Box ref={ref} sx={{ height: 1 }} />
}
