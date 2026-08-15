import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

import type { LoanResponse } from '@/api/queries/loans'
import { Btn, Card } from '@/components/primitives'
import { LoadMoreFooter } from '@/components/infinite/InfiniteFooter'
import { fmtDate, fmtINR } from '@/lib/format'
import { loanDisplayId } from '../loanIdentity'
import { ApproveAction } from './LoanActions'

// The "Awaiting approval" view: instead of a table row per draft, a box per
// finance surfacing exactly what an admin weighs before approving — who, what
// vehicle, the terms, the due date — with the Approve action right on the card.
// Approve reuses the full flow (completeness gate + confirm dialog); when a
// finance still has gaps, "Fix" sends the admin to its detail page.
export function ApprovalQueue({
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
          <ApprovalCard key={loan.id} loan={loan} />
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

function ApprovalCard({ loan }: { loan: LoanResponse }) {
  const navigate = useNavigate()
  const goToDetail = () =>
    navigate({ to: '/finances/$loanId', params: { loanId: loan.id } })

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

      {/* Push the actions to the card bottom so a grid row of cards aligns. */}
      <Box sx={{ mt: 'auto', pt: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Btn variant="ghost" size="sm" onClick={goToDetail} sx={{ flexShrink: 0 }}>
            View
          </Btn>
          <Box sx={{ flexGrow: 1 }}>
            <ApproveAction loan={loan} compact onGuide={goToDetail} />
          </Box>
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
