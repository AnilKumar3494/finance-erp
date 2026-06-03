import { createFileRoute } from '@tanstack/react-router'

import { LoanCreatePage } from '@/features/loans/pages/LoanCreatePage'

export const Route = createFileRoute('/_authed/finances/new')({
  staticData: { title: 'New finance' },
  component: LoanCreatePage,
})
