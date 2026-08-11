import { useMemo, useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined'

import { useLoan, type LoanResponse } from '@/api/queries/loans'
import type { LoanStatus } from '@/schemas/enums'
import { useCustomer } from '@/api/queries/customers'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useLoanSummary, useLoanTransactions } from '@/api/queries/transactions'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { deriveNetDue } from '../cycleNetDue'
import { LoanIdentityCard } from '../components/LoanIdentityCard'
import { LoanTermsCard } from '../components/LoanTermsCard'
import { RecordPaymentDialog } from '../components/RecordPaymentDialog'
import { LoanActions } from '../components/LoanActions'
import { LoanSubResources } from '../components/LoanSubResources'
import { DeleteDraftAction } from '../components/DeleteDraftAction'
import { DocScoreCard } from '../components/DocScoreCard'
import { computeApprovalGaps, type ApprovalSectionKey } from '../approvalReadiness'
import { FieldGrid, FieldRow } from '../components/DetailFields'
import { useFinancePermissions } from '../financePermissions'
import { VehicleInfoSection } from '../sections/VehicleInfoSection'
import { FinanceInfoSection } from '../sections/FinanceInfoSection'
import { CustomerInfoSection } from '../sections/CustomerInfoSection'
import { PersonnelInfoSection } from '../sections/PersonnelInfoSection'
import { AllDocumentsSection } from '../sections/AllDocumentsSection'

interface LoanDetailPageProps {
  loanId: string
}

// Loans whose cycles can still be collected on — the loans for which the
// Collections workspace (cockpit) is a useful destination. Mirrors the
// backend worklist's _COLLECTIBLE_LOAN_STATUSES.
const COLLECTIBLE_STATUSES: ReadonlySet<LoanStatus> = new Set<LoanStatus>([
  'ACTIVE',
  'AWAITING_CLOSURE',
  'BAD_DEBT_PROPOSED',
])

function mapDetailError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 404) return 'Finance not found.'
    if (status === 403) return 'You do not have access to this finance.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this finance.'
}

export function LoanDetailPage({ loanId }: LoanDetailPageProps) {
  const navigate = useNavigate()
  const query = useLoan(loanId)

  return (
    <Box sx={{ width: { xs: '100%', md: '80%' }, mx: 'auto' }}>
      <Stack
        direction="row"
        sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
      >
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
        >
          Finances
        </Btn>
        {query.data && COLLECTIBLE_STATUSES.has(query.data.status) && (
          <Btn
            variant="primary"
            size="sm"
            startIcon={<PaymentsIcon />}
            onClick={() =>
              navigate({
                to: '/finances/$loanId/collections',
                params: { loanId },
              })
            }
          >
            Collections workspace
          </Btn>
        )}
      </Stack>

      {query.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : query.isError ? (
        <ErrorBanner message={mapDetailError(query.error)} />
      ) : query.data ? (
        <DetailBody loan={query.data} />
      ) : null}
    </Box>
  )
}

function DetailBody({ loan }: { loan: LoanResponse }) {
  const perms = useFinancePermissions(loan)
  // Approval "walk-through": the Loan-actions checklist bumps a per-section
  // counter to scroll to and open the editor of an incomplete section.
  const [guide, setGuide] = useState<{ key: ApprovalSectionKey; n: number } | null>(null)
  const goToSection = (key: ApprovalSectionKey) =>
    setGuide((prev) => ({ key, n: (prev?.n ?? 0) + 1 }))
  const signalFor = (key: ApprovalSectionKey) => (guide?.key === key ? guide.n : undefined)

  // Surface the approval gaps in-line (warning banners, yellow Edit buttons,
  // highlighted inputs) only while it's actionable: an admin on a DRAFT.
  const customerQuery = useCustomer(loan.customer_id)
  const showGaps = perms.isAdmin && loan.status === 'DRAFT'
  const gaps = showGaps ? computeApprovalGaps(loan, customerQuery.data ?? null) : []
  const missingFor = (key: ApprovalSectionKey) => gaps.find((g) => g.key === key)?.missing

  // On a DRAFT the primary task is approval, so Loan actions sit right under the
  // header. On everything else it's mostly a read-only review, so actions drop
  // to the bottom, just before Audit.
  const isDraft = loan.status === 'DRAFT'

  return (
    <Stack spacing={3}>
      <HeaderCard loan={loan} />

      <DocScoreCard loan={loan} />

      {isDraft && <LoanActions loan={loan} onGuideSection={goToSection} />}

      <VehicleInfoSection
        loan={loan}
        perm={perms.vehicle}
        openSignal={signalFor('vehicle')}
        missing={missingFor('vehicle')}
      />
      <FinanceInfoSection
        loan={loan}
        perm={perms.finance}
        openSignal={signalFor('finance')}
        missing={missingFor('finance')}
      />
      <CustomerInfoSection
        loan={loan}
        perm={perms.customer}
        openSignal={signalFor('customer')}
        missing={missingFor('customer')}
      />
      <PersonnelInfoSection loan={loan} perm={perms.personnel} />
      <AllDocumentsSection loan={loan} perm={perms.documents} />

      <LoanSubResources loan={loan} />

      {!isDraft && <LoanActions loan={loan} onGuideSection={goToSection} />}

      {perms.isAdmin && loan.status === 'DRAFT' && <DeleteDraftAction loan={loan} />}

      <AuditCard loan={loan} />
    </Stack>
  )
}

// --------------------------------------------------
// Header — loan number, status, principal
// --------------------------------------------------

function HeaderCard({ loan }: { loan: LoanResponse }) {
  const isDraft = loan.status === 'DRAFT'
  // Collectible statuses can take a payment. Cycles + balances only exist after
  // approval; the summary carries Outstanding / Total paid. Same plumbing as the
  // Collections workspace so the card reads identically.
  const payable = loan.status === 'ACTIVE' || loan.status === 'AWAITING_CLOSURE'
  const cyclesQuery = useDueCycles(loan.id, !isDraft)
  const summaryQuery = useLoanSummary(loan.id, !isDraft)
  const txnsQuery = useLoanTransactions(loan.id, !isDraft)
  const cycles = useMemo(() => cyclesQuery.data?.results ?? [], [cyclesQuery.data])
  const txns = txnsQuery.data?.results ?? []

  // Net-due waterfall (same as the schedule tab) → the focus cycle: the
  // lowest-numbered cycle that still genuinely owes money.
  const netDueByCycleId = useMemo(
    () => deriveNetDue(cycles, Number(summaryQuery.data?.total_paid ?? 0)),
    [cycles, summaryQuery.data],
  )
  const focusCycle = useMemo(
    () =>
      cycles
        .filter((c) => (netDueByCycleId.get(c.id)?.netDue ?? 0) > 0)
        .sort((a, b) => a.cycle_number - b.cycle_number)[0] ?? null,
    [cycles, netDueByCycleId],
  )
  const focusNet = focusCycle ? netDueByCycleId.get(focusCycle.id) : undefined
  const penaltiesTotal = cycles.reduce((a, c) => a + Number(c.penalty_amount), 0)
  const pendingTxns = txns.filter((t) => t.status === 'PENDING')
  const pendingTotal = pendingTxns.reduce((a, t) => a + Number(t.amount), 0)

  const [recordOpen, setRecordOpen] = useState(false)
  const [seedCycleId, setSeedCycleId] = useState('')
  const [seedAmount, setSeedAmount] = useState('')
  const onRecord = () => {
    const net = focusCycle ? (netDueByCycleId.get(focusCycle.id)?.netDue ?? 0) : 0
    setSeedCycleId(focusCycle?.id ?? '')
    setSeedAmount(net > 0 ? net.toFixed(2) : '')
    setRecordOpen(true)
  }

  return (
    <>
      <LoanIdentityCard loan={loan} eyebrow="Finance" showLmsNumber />
      <LoanTermsCard
        loan={loan}
        summary={summaryQuery.data}
        focusCycle={focusCycle}
        focusNet={focusNet}
        penaltiesTotal={penaltiesTotal}
        pendingCount={pendingTxns.length}
        pendingTotal={pendingTotal}
        showMoney={!isDraft}
        onRecord={onRecord}
        showRecord={payable}
      />
      <RecordPaymentDialog
        loanId={loan.id}
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        defaultCycleId={seedCycleId}
        defaultAmount={seedAmount}
      />
    </>
  )
}

// --------------------------------------------------
// Audit metadata (IST)
// --------------------------------------------------

function AuditCard({ loan }: { loan: LoanResponse }) {
  const actor = (
    nested: LoanResponse['created_by'],
    fallbackId: string | null,
  ): string | undefined => {
    if (nested) return nested.full_name?.trim() || nested.username
    return fallbackId ?? undefined
  }
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Audit
      </Typography>
      <FieldGrid>
        {/* No fallback to created_at: an unapproved loan has no approval
            date, and showing when the draft was created in its place reads
            as a real approval that never happened. */}
        <FieldRow label="Approved at" value={fmtDate(loan.approval_date)} />
        <FieldRow label="Created at" value={fmtDateTime(loan.created_at)} />
        <FieldRow label="Last updated" value={fmtDateTime(loan.updated_at)} />
        <FieldRow label="Created by" value={actor(loan.created_by, loan.created_by_id)} />
        <FieldRow label="Updated by" value={actor(loan.updated_by, loan.updated_by_id)} />
      </FieldGrid>
    </Card>
  )
}
