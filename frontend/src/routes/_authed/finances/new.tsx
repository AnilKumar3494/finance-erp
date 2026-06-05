import { createFileRoute } from '@tanstack/react-router'

import { FinanceWizardPage } from '@/features/loans/pages/FinanceWizardPage'

// Step 0 is the customer gate (creates the DRAFT); steps 1..5 are the content
// sections. Persisting financeId + step in the URL keeps wizard progress across
// refresh, back/forward, and direct step navigation.
export interface NewFinanceSearch {
  financeId?: string
  step: number
}

const MAX_STEP = 5

export const Route = createFileRoute('/_authed/finances/new')({
  staticData: { title: 'New finance' },
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
    return { financeId, step }
  },
  component: FinanceWizardPage,
})
