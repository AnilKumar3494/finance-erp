import { useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useCreateLoan } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { CustomerPicker } from '@/features/loans/components/CustomerPicker'

// The section roadmap. Index 0 is the customer-selection gate that creates the
// DRAFT finance; the rest are built section by section.
const STEPS = [
  'Customer',
  'Customer & KYC',
  'Stability docs',
  'Vehicle',
  'Personnel',
  'Photos',
  'Financials',
] as const

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

  const submitError = create.isError ? mapCreateError(create.error) : null

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 3, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="h2">New finance</Typography>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
          disabled={create.isPending}
        >
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

      {financeId == null ? (
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
        <Card>
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CheckCircleIcon sx={{ color: 'success.main' }} />
              <Typography variant="h3">Draft finance created</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {customer?.full_name} ·{' '}
              <Box component="span" sx={{ fontFamily: 'var(--font-mono)' }}>
                {loanNumber}
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The remaining sections (customer KYC, stability documents, vehicle,
              personnel, photos, and financials) are built next. You can open the
              finance now to review it.
            </Typography>
            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <Btn
                variant="ghost"
                onClick={() => navigate({ to: '/finances', search: { page: 1 } })}
              >
                Back to finances
              </Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  navigate({ to: '/finances/$loanId', params: { loanId: financeId } })
                }
              >
                Open finance
              </Btn>
            </Stack>
          </Stack>
        </Card>
      )}
    </Box>
  )
}
