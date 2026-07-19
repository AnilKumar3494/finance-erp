import { createFileRoute } from '@tanstack/react-router'

import { LoanDetailPage } from '@/features/loans/pages/LoanDetailPage'

export const Route = createFileRoute('/_authed/finances/$loanId/')({
  staticData: { title: 'Finance Detail' },
  component: RouteComponent,
})

function RouteComponent() {
  const { loanId } = Route.useParams()
  return <LoanDetailPage loanId={loanId} />
}
