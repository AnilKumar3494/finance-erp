import { createFileRoute } from '@tanstack/react-router'

import { LoanEditPage } from '@/features/loans/pages/LoanEditPage'

export const Route = createFileRoute('/_authed/finances/$loanId/edit')({
  staticData: { title: 'Edit finance' },
  component: RouteComponent,
})

function RouteComponent() {
  const { loanId } = Route.useParams()
  return <LoanEditPage loanId={loanId} />
}
