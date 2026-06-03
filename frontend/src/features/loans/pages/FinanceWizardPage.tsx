import { useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'

import { useCreateLoan } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { CustomerPicker } from '@/features/loans/components/CustomerPicker'
import { CustomerKycSection } from '@/features/loans/wizard/CustomerKycSection'

// Index 0 is the customer gate that creates the DRAFT; 1..5 are content sections.
// Customer & KYC includes identity-proof and stability-proof documents.
const STEPS = [
  'Customer',
  'Customer & KYC',
  'Vehicle',
  'Personnel',
  'Photos',
  'Financials',
] as const
const LAST_STEP = STEPS.length - 1

function mapCreateError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 400) return detail ?? 'Could not start the finance. Check the customer and try again.'
    if (status === 403) return detail ?? 'You do not have permission to start a finance for this customer.'
    if (status === 404) return detail ?? 'Customer not found.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong starting the finance. Please try again.'
}

export function FinanceWizardPage() {
  const navigate = useNavigate()
  const create = useCreateLoan()

  const [financeId, setFinanceId] = useState<string | null>(null)
  const [loanNumber, setLoanNumber] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerResponse | null>(null)
  const [customerError, setCustomerError] = useState<string>()
  const [step, setStep] = useState(0)

  const startFinance = () => {
    if (!customer) {
      setCustomerError('Select a customer to start the finance')
      return
    }
    create.mutate(
      { customer_id: customer.id },
      {
        onSuccess: (loan) => {
          setFinanceId(loan.id)
          setLoanNumber(loan.loan_number)
          setStep(1)
        },
        onError: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      },
    )
  }

  const exit = () => navigate({ to: '/finances', search: { page: 1 } })
  const openFinance = () =>
    financeId && navigate({ to: '/finances/$loanId', params: { loanId: financeId } })

  const submitError = create.isError ? mapCreateError(create.error) : null

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 3, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h2">New finance</Typography>
          {loanNumber && (
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
              {loanNumber}
            </Typography>
          )}
        </Box>
        <Btn variant="ghost" size="sm" onClick={exit} disabled={create.isPending}>
          Exit
        </Btn>
      </Stack>

      <Box sx={{ mb: 3, overflowX: 'auto' }}>
        <Stepper activeStep={step} alternativeLabel sx={{ minWidth: 560 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={submitError} />
        </Box>
      )}

      {financeId == null || customer == null ? (
        <Card>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Select the customer
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Choose the customer this finance is for. We create a draft immediately so
            documents, vehicle, and personnel can be attached as you go.
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
          <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: 'flex-end' }}>
            <Btn variant="primary" onClick={startFinance} loading={create.isPending}>
              Start finance
            </Btn>
          </Stack>
        </Card>
      ) : (
        <>
          {step === 1 && <CustomerKycSection financeId={financeId} customerId={customer.id} />}
          {step >= 2 && <SectionComingSoon title={STEPS[step]} />}

          <Stack
            direction="row"
            spacing={2}
            sx={{ mt: 3, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Btn variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step <= 1}>
              ‹ Back
            </Btn>
            <Btn variant="ghost" size="sm" onClick={openFinance}>
              Open finance
            </Btn>
            {step < LAST_STEP ? (
              <Btn variant="primary" onClick={() => setStep((s) => Math.min(LAST_STEP, s + 1))}>
                Continue ›
              </Btn>
            ) : (
              <Btn variant="primary" onClick={openFinance}>
                Finish
              </Btn>
            )}
          </Stack>
        </>
      )}
    </Box>
  )
}

function SectionComingSoon({ title }: { title: string }) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        This section is being built. The draft finance is saved — you can continue
        through the other sections or open the finance to review it.
      </Typography>
    </Card>
  )
}
