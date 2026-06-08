import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepButton from '@mui/material/StepButton'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import PersonAddIcon from '@mui/icons-material/PersonAddAltOutlined'

import { useCreateLoan, useLoan, type LoanResponse } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner, Spinner } from '@/components/primitives'
import { CustomerPicker } from '@/features/loans/components/CustomerPicker'
import { QuickAddCustomerDialog } from '@/features/loans/components/QuickAddCustomerDialog'
import { CustomerKycSection } from '@/features/loans/wizard/CustomerKycSection'
import { VehicleSection } from '@/features/loans/wizard/VehicleSection'
import { PersonnelSection } from '@/features/loans/wizard/PersonnelSection'
import { PhotosSection } from '@/features/loans/wizard/PhotosSection'
import { FinancialsSection } from '@/features/loans/wizard/FinancialsSection'
import { WizardGuardContext, type WizardGuardApi } from '@/features/loans/wizard/wizardGuard'

// Index 0 is the customer gate that creates the DRAFT; 1..5 are content
// sections. Customer & KYC includes identity-proof and stability-proof
// documents.
const STEPS = [
  'Customer',
  'Customer & KYC',
  'Vehicle',
  'Personnel',
  'Photos',
  'Financials',
] as const
const FIRST_CONTENT_STEP = 1
const LAST_STEP = STEPS.length - 1

// financeId + step live in the URL (see the route's validateSearch) so progress
// survives refresh, back/forward, and direct step navigation.
const route = getRouteApi('/_authed/finances/new')

function mapCreateError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 400)
      return detail ?? 'Could not start the finance. Check the customer and try again.'
    if (status === 403)
      return detail ?? 'You do not have permission to start a finance for this customer.'
    if (status === 404) return detail ?? 'Customer not found.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong starting the finance. Please try again.'
}

export function FinanceWizardPage() {
  const navigate = useNavigate()
  const { financeId, step } = route.useSearch()
  // Enabled only once a draft exists; reconstructs the customer + loan number
  // when the wizard is resumed from a URL.
  const loanQuery = useLoan(financeId)
  const loan = loanQuery.data ?? null

  // Unsaved-changes guard. Each step's form reports its dirty state into this
  // map; navigating away while anything is dirty pops a confirmation.
  const dirtyForms = useRef(new Map<symbol, boolean>())
  const guardApi = useMemo<WizardGuardApi>(
    () => ({
      register: (id, dirty) => {
        dirtyForms.current.set(id, dirty)
      },
      unregister: (id) => {
        dirtyForms.current.delete(id)
      },
    }),
    [],
  )
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null)
  const anyDirty = useCallback(() => Array.from(dirtyForms.current.values()).some(Boolean), [])
  const guard = useCallback(
    (proceed: () => void) => {
      if (anyDirty()) setPendingNav({ run: proceed })
      else proceed()
    },
    [anyDirty],
  )

  // Refresh / tab-close / external navigation: the in-app guard can't intercept
  // these, so fall back to the browser's native "Leave site?" prompt while any
  // step form holds unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (anyDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [anyDirty])

  const goStep = (s: number) =>
    guard(() =>
      navigate({
        to: '/finances/new',
        search: (prev) => ({ ...prev, step: Math.min(LAST_STEP, Math.max(FIRST_CONTENT_STEP, s)) }),
        replace: true,
      }),
    )

  const startedDraft = (loanId: string) =>
    navigate({
      to: '/finances/new',
      search: { financeId: loanId, step: FIRST_CONTENT_STEP },
      replace: true,
    })

  const exit = () => guard(() => navigate({ to: '/finances', search: { page: 1 } }))

  const openFinance = () =>
    guard(() => {
      if (financeId) navigate({ to: '/finances/$loanId', params: { loanId: financeId } })
    })

  const leaveAnyway = () => {
    const next = pendingNav
    dirtyForms.current.clear()
    setPendingNav(null)
    next?.run()
  }

  return (
    <WizardGuardContext.Provider value={guardApi}>
      <Box sx={{ maxWidth: 820, mx: 'auto' }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ mb: 3, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2">New finance</Typography>
            {loan?.loan_number && (
              <Typography variant="body2" color="text.secondary">
                <Box component="span" sx={{ fontFamily: 'var(--font-mono)' }}>
                  {loan.loan_number}
                </Box>
                {loan.customer?.full_name && (
                  <Box component="span"> · {loan.customer.full_name}</Box>
                )}
              </Typography>
            )}
          </Box>
          <Btn variant="ghost" size="sm" onClick={exit}>
            Exit
          </Btn>
        </Stack>

        <WizardStepper step={step} clickable={financeId != null} onStep={goStep} />

        {financeId == null ? (
          <CustomerGate onStarted={startedDraft} />
        ) : loanQuery.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <Spinner size={26} />
          </Box>
        ) : loanQuery.isError || !loan ? (
          <ErrorBanner message="Could not load this draft finance." />
        ) : (
          <WizardBody loan={loan} step={step} onStep={goStep} onOpenFinance={openFinance} />
        )}

        <UnsavedChangesDialog
          open={pendingNav != null}
          onStay={() => setPendingNav(null)}
          onLeave={leaveAnyway}
        />
      </Box>
    </WizardGuardContext.Provider>
  )
}

// --------------------------------------------------
// Stepper — content steps (1..5) are clickable once a draft exists.
// --------------------------------------------------

function WizardStepper({
  step,
  clickable,
  onStep,
}: {
  step: number
  clickable: boolean
  onStep: (step: number) => void
}) {
  return (
    <Box sx={{ mb: 3, overflowX: 'auto', overflowY: 'hidden', pb: 1 }}>
      <Stepper activeStep={step} alternativeLabel nonLinear sx={{ minWidth: 560 }}>
        {STEPS.map((label, i) => (
          <Step key={label}>
            {clickable && i >= FIRST_CONTENT_STEP ? (
              <StepButton onClick={() => onStep(i)}>{label}</StepButton>
            ) : (
              <StepLabel>{label}</StepLabel>
            )}
          </Step>
        ))}
      </Stepper>
    </Box>
  )
}

// --------------------------------------------------
// Step 0 — pick a customer and create the DRAFT.
// --------------------------------------------------

function CustomerGate({ onStarted }: { onStarted: (loanId: string) => void }) {
  const create = useCreateLoan()
  const [customer, setCustomer] = useState<CustomerResponse | null>(null)
  const [customerError, setCustomerError] = useState<string>()
  const [addOpen, setAddOpen] = useState(false)

  const start = () => {
    if (!customer) {
      setCustomerError('Select a customer to start the finance')
      return
    }
    create.mutate(
      { customer_id: customer.id },
      {
        onSuccess: (loan) => onStarted(loan.id),
        onError: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      },
    )
  }

  const submitError = create.isError ? mapCreateError(create.error) : null

  return (
    <>
      {submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={submitError} />
        </Box>
      )}
      <Card>
        <Typography variant="h3" sx={{ mb: 1 }}>
          Select the customer
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Choose the customer this finance is for. We create a draft immediately so documents,
          vehicle, and personnel can be attached as you go.
        </Typography>
        <CustomerPicker
          value={customer}
          onChange={(c) => {
            setCustomer(c)
            if (c) setCustomerError(undefined)
          }}
          required
          error={customerError}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            Add a new customer:
          </Typography>
          <Btn
            variant="ghost"
            size="sm"
            startIcon={<PersonAddIcon />}
            onClick={() => setAddOpen(true)}
          >
            New Customer
          </Btn>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: 'flex-end' }}>
          <Btn variant="primary" onClick={start} loading={create.isPending}>
            Start finance
          </Btn>
        </Stack>
      </Card>

      <QuickAddCustomerDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(c) => {
          setCustomer(c)
          setCustomerError(undefined)
          setAddOpen(false)
        }}
      />
    </>
  )
}

// --------------------------------------------------
// Steps 1..5 — content sections. Each section saves to the server as the user
// fills it, so navigating between steps never loses saved data.
// --------------------------------------------------

function WizardBody({
  loan,
  step,
  onStep,
  onOpenFinance,
}: {
  loan: LoanResponse
  step: number
  onStep: (step: number) => void
  onOpenFinance: () => void
}) {
  const customerId = loan.customer_id

  return (
    <>
      {step === 1 && <CustomerKycSection financeId={loan.id} customerId={customerId} />}
      {step === 2 && <VehicleSection financeId={loan.id} customerId={customerId} />}
      {step === 3 && <PersonnelSection financeId={loan.id} customerId={customerId} />}
      {step === 4 && <PhotosSection financeId={loan.id} customerId={customerId} />}
      {step === 5 && <FinancialsSection financeId={loan.id} />}

      <Stack
        direction="row"
        spacing={2}
        sx={{ mt: 3, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Btn variant="ghost" onClick={() => onStep(step - 1)} disabled={step <= FIRST_CONTENT_STEP}>
          ‹ Back
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onOpenFinance}>
          Open finance
        </Btn>
        {step < LAST_STEP ? (
          <Btn variant="primary" onClick={() => onStep(step + 1)}>
            Continue ›
          </Btn>
        ) : (
          <Btn variant="primary" onClick={onOpenFinance}>
            Finish
          </Btn>
        )}
      </Stack>
    </>
  )
}

// --------------------------------------------------
// Unsaved-changes confirmation
// --------------------------------------------------

function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <Dialog open={open} onClose={onStay} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontSize: 18 }}>
        <WarningAmberRoundedIcon sx={{ color: 'warning.main' }} fontSize="small" />
        Unsaved changes
      </DialogTitle>
      <DialogContent sx={{ pb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          You have unsaved changes on this step. Save them first — if you leave now, they’ll be
          lost.
        </Typography>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          pb: 2.5,
          pt: 0,
          gap: 1,
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          // Spacing is handled by `gap`; drop MUI's default sibling margin so it
          // doesn't double up (row) or misalign the stacked layout (mobile).
          '& > :not(:first-of-type)': { ml: 0 },
          '& > button': { width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' },
        }}
      >
        <Btn variant="ghost" onClick={onStay}>
          Keep editing
        </Btn>
        <Btn variant="danger" onClick={onLeave}>
          Leave without saving
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
