import { type ReactNode } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import PersonIcon from '@mui/icons-material/PersonOutlineOutlined'

import { useLoan, type LoanResponse } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format'
import { LoanStatusChip } from '../components/LoanStatusChip'
import { LoanActions } from '../components/LoanActions'
import { LoanSubResources } from '../components/LoanSubResources'

interface LoanDetailPageProps {
  loanId: string
}

function mapDetailError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 404) return 'Loan not found.'
    if (status === 403) return 'You do not have access to this loan.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading this loan.'
}

const money = (v: string | null) => (v === null ? undefined : fmtINR(Number(v)))

export function LoanDetailPage({ loanId }: LoanDetailPageProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const query = useLoan(loanId)

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const editableStatus =
    query.data?.status === 'DRAFT' || query.data?.status === 'ACTIVE'
  const canEdit = isAdmin && editableStatus

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
        >
          Loans
        </Btn>
        {canEdit && (
          <Btn
            variant="ghost"
            size="sm"
            startIcon={<EditIcon />}
            onClick={() => navigate({ to: '/finances/$loanId/edit', params: { loanId } })}
          >
            Edit
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
  return (
    <Stack spacing={3}>
      <HeaderCard loan={loan} />
      <LoanActions loan={loan} />
      <TermsCard loan={loan} />
      <PartiesCard loan={loan} />
      <FeesCard loan={loan} />
      <LifecycleCard loan={loan} />
      <LoanSubResources loan={loan} />
      <AuditCard loan={loan} />
    </Stack>
  )
}

// --------------------------------------------------
// Header — loan number, status, principal
// --------------------------------------------------

function HeaderCard({ loan }: { loan: LoanResponse }) {
  return (
    <Card>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="text.secondary">
              Loan
            </Typography>
            <Typography
              variant="h1"
              sx={{ fontSize: { xs: 20, sm: 24 }, fontFamily: 'var(--font-mono)' }}
            >
              {loan.loan_number}
            </Typography>
          </Box>
          <LoanStatusChip status={loan.status} size="medium" />
        </Stack>
        <Divider />
        <Box>
          <Typography variant="caption" color="text.secondary">
            Principal
          </Typography>
          <Typography variant="h2">
            {loan.principal != null ? fmtINR(Number(loan.principal)) : '—'}
          </Typography>
        </Box>
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Loan terms + computed amounts
// --------------------------------------------------

function TermsCard({ loan }: { loan: LoanResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Loan terms
      </Typography>
      <FieldGrid>
        <FieldRow
          label="Principal"
          value={loan.principal != null ? fmtINR(Number(loan.principal)) : undefined}
        />
        <FieldRow
          label="Interest rate"
          value={loan.interest_rate != null ? `${loan.interest_rate}% p.a.` : undefined}
        />
        <FieldRow
          label="Tenure"
          value={loan.tenure != null ? `${loan.tenure} months` : undefined}
        />
        <FieldRow label="Monthly interest" value={money(loan.monthly_interest)} />
        <FieldRow label="Total payable" value={money(loan.total_payable)} />
      </FieldGrid>
    </Card>
  )
}

// --------------------------------------------------
// Parties — customer (linked) + vehicle (read-only)
// --------------------------------------------------

function PartiesCard({ loan }: { loan: LoanResponse }) {
  const navigate = useNavigate()
  const vehicle = loan.vehicle
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Parties
      </Typography>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Customer
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 0.5, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Box>
              <Typography variant="body1">{loan.customer?.full_name ?? '—'}</Typography>
              {loan.customer?.mobile_number && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontFamily: 'var(--font-mono)' }}
                >
                  {loan.customer.mobile_number}
                </Typography>
              )}
            </Box>
            <Btn
              variant="ghost"
              size="sm"
              startIcon={<PersonIcon />}
              onClick={() =>
                navigate({
                  to: '/customers/$customerId',
                  params: { customerId: loan.customer_id },
                })
              }
            >
              View
            </Btn>
          </Stack>
        </Box>
        <Divider />
        <Box>
          <Typography variant="caption" color="text.secondary">
            Vehicle (collateral)
          </Typography>
          {vehicle ? (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)' }}>
                {vehicle.plate_number}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
                {vehicle.year ? ` · ${vehicle.year}` : ''}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              No collateral attached.
            </Typography>
          )}
        </Box>
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Fees and disbursement breakdown
// --------------------------------------------------

function FeesCard({ loan }: { loan: LoanResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Fees and disbursement
      </Typography>
      <FieldGrid>
        <FieldRow label="Down payment" value={fmtINR(Number(loan.down_payment))} />
        <FieldRow label="Processing fee" value={fmtINR(Number(loan.processing_fee))} />
        <FieldRow
          label="Documentation fee"
          value={fmtINR(Number(loan.documentation_fee))}
        />
        <FieldRow label="Net loan principal" value={money(loan.net_loan_principal)} />
        <FieldRow label="Net disbursed amount" value={money(loan.net_disbursed_amount)} />
      </FieldGrid>
    </Card>
  )
}

// --------------------------------------------------
// Lifecycle — status, approval, penalty
// --------------------------------------------------

function LifecycleCard({ loan }: { loan: LoanResponse }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Lifecycle
      </Typography>
      <FieldGrid>
        <FieldRow label="Approval date" value={fmtDate(loan.approval_date) || undefined} />
        <FieldRow
          label="Due day of month"
          value={loan.due_day_of_month != null ? String(loan.due_day_of_month) : undefined}
        />
        <FieldRow
          label="Penalty rate"
          value={loan.penalty_rate != null ? `${loan.penalty_rate}% per month` : undefined}
        />
      </FieldGrid>
    </Card>
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

// --------------------------------------------------
// Layout helpers
// --------------------------------------------------

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: { xs: 1.5, sm: 2.5 },
      }}
    >
      {children}
    </Box>
  )
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const hasValue = value !== null && value !== undefined && value !== ''
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          color: hasValue ? 'text.primary' : 'text.secondary',
        }}
      >
        {hasValue ? value : '—'}
      </Typography>
    </Box>
  )
}
