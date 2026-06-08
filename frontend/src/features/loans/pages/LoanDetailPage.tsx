import { useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'

import { useLoan, type LoanResponse } from '@/api/queries/loans'
import { useCustomer } from '@/api/queries/customers'
import { useDueCycles } from '@/api/queries/dueCycles'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format'
import { LoanStatusChip } from '../components/LoanStatusChip'
import { LoanActions } from '../components/LoanActions'
import { LoanSubResources } from '../components/LoanSubResources'
import { DeleteDraftAction } from '../components/DeleteDraftAction'
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
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 2 }}>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
        >
          Finances
        </Btn>
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

  return (
    <Stack spacing={3}>
      <HeaderCard loan={loan} />
      <LoanActions loan={loan} onGuideSection={goToSection} />

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

      {perms.isAdmin && loan.status === 'DRAFT' && <DeleteDraftAction loan={loan} />}

      <AuditCard loan={loan} />
    </Stack>
  )
}

// --------------------------------------------------
// Header — loan number, status, principal
// --------------------------------------------------

function HeaderCard({ loan }: { loan: LoanResponse }) {
  // Due cycles only exist after approval; the next UPCOMING one is the EMI to
  // collect next.
  const cyclesQuery = useDueCycles(loan.id, loan.status !== 'DRAFT')
  const nextEmi =
    (cyclesQuery.data?.results ?? [])
      .filter((c) => c.cycle_status === 'UPCOMING')
      .sort((a, b) => a.cycle_number - b.cycle_number)[0] ?? null

  return (
    <Card>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Finance
            </Typography>
            <Typography
              variant="h1"
              sx={{ fontSize: { xs: 20, sm: 24 }, fontFamily: 'var(--font-mono)' }}
            >
              {loan.loan_number}
            </Typography>
            {loan.customer?.full_name && (
              <Box sx={{ mt: 0.75 }}>
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Name:{' '}
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {loan.customer.full_name}
                  </Box>
                </Typography>
                {loan.customer.mobile_number && (
                  <Typography variant="body2">
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Phone Number:{' '}
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {loan.customer.mobile_number}
                    </Box>
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          <LoanStatusChip status={loan.status} size="medium" />
        </Stack>
        <Divider />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
            gap: { xs: 1.5, sm: 2.5 },
          }}
        >
          <HeaderStat
            label="Principal"
            value={loan.principal != null ? fmtINR(Number(loan.principal)) : '—'}
          />
          {nextEmi && (
            <HeaderStat
              label="Next EMI"
              value={fmtINR(Number(nextEmi.base_emi))}
              hint={`due ${fmtDate(nextEmi.due_date)}`}
            />
          )}
          {loan.tenure != null && <HeaderStat label="Tenure" value={`${loan.tenure} months`} />}
          {loan.interest_rate != null && (
            <HeaderStat label="Interest rate" value={`${loan.interest_rate}% p.a.`} />
          )}
          {loan.total_payable != null && (
            <HeaderStat label="Total payable" value={fmtINR(Number(loan.total_payable))} />
          )}
        </Box>
      </Stack>
    </Card>
  )
}

function HeaderStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 16, sm: 18 } }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
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
        <FieldRow label="Created" value={fmtDateTime(loan.created_at)} />
        <FieldRow label="Last updated" value={fmtDateTime(loan.updated_at)} />
        <FieldRow label="Created by" value={actor(loan.created_by, loan.created_by_id)} />
        <FieldRow label="Updated by" value={actor(loan.updated_by, loan.updated_by_id)} />
      </FieldGrid>
    </Card>
  )
}
