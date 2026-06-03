import { createFileRoute } from '@tanstack/react-router'

import { FinanceWizardPage } from '@/features/loans/pages/FinanceWizardPage'

export const Route = createFileRoute('/_authed/finances/new')({
  staticData: { title: 'New finance' },
  component: FinanceWizardPage,
})
