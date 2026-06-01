import { createFileRoute } from '@tanstack/react-router'

import { LoanCreatePage } from '@/features/loans/pages/LoanCreatePage'

export const Route = createFileRoute('/_authed/loans/new')({
  staticData: { title: 'New loan' },
  component: LoanCreatePage,
})
