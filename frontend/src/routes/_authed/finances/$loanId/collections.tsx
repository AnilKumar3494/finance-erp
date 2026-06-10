import { createFileRoute } from '@tanstack/react-router'

import { LoanCollectionsPage } from '@/features/loans/pages/LoanCollectionsPage'

// Per-loan Collections workspace ("cockpit"). All Record-payment entry points
// across the app route here; `?action=record&cycleId=<uuid>` auto-opens the
// dialog seeded with that cycle.
interface CollectionsSearch {
  action?: 'record'
  cycleId?: string
}

export const Route = createFileRoute('/_authed/finances/$loanId/collections')({
  staticData: { title: 'Collections workspace' },
  validateSearch: (raw: Record<string, unknown>): CollectionsSearch => {
    const action = raw.action === 'record' ? 'record' : undefined
    const cycleId =
      typeof raw.cycleId === 'string' && raw.cycleId.length > 0 ? raw.cycleId : undefined
    return { action, cycleId }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { loanId } = Route.useParams()
  return <LoanCollectionsPage loanId={loanId} />
}
