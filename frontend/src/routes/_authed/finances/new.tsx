import { createFileRoute } from '@tanstack/react-router'

import { FinanceWizardPage } from '@/features/loans/pages/FinanceWizardPage'

// Step 0 is the customer gate (creates the DRAFT); steps 1..5 are the content
// sections. Persisting financeId + step in the URL keeps wizard progress across
// refresh, back/forward, and direct step navigation.
export interface NewFinanceSearch {
  financeId?: string
  step: number
  // Optional pre-selection for step 0, set by "Create finance" on a customer's
  // detail page. It only seeds the picker — the draft is still created by
  // "Start finance", so arriving here never writes anything on its own. Dropped
  // once a draft exists, since the customer is then fixed on the loan.
  customerId?: string
}

const MAX_STEP = 5

export const Route = createFileRoute('/_authed/finances/new')({
  staticData: { title: 'New Finance' },
  validateSearch: (raw: Record<string, unknown>): NewFinanceSearch => {
    const financeId =
      typeof raw.financeId === 'string' && raw.financeId.length > 0
        ? raw.financeId
        : undefined
    const n = Number(raw.step)
    const parsed = Number.isFinite(n) ? Math.floor(n) : NaN
    // Without a draft the only valid step is the customer gate (0). With a
    // draft the user may sit on any content step (1..MAX_STEP).
    const step = financeId
      ? parsed >= 1 && parsed <= MAX_STEP
        ? parsed
        : 1
      : 0
    const customerId =
      !financeId && typeof raw.customerId === 'string' && raw.customerId.length > 0
        ? raw.customerId
        : undefined
    return { financeId, step, customerId }
  },
  component: FinanceWizardPage,
})
