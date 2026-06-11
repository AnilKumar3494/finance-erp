import { createFileRoute } from '@tanstack/react-router'

import { LoanCollectionsPage } from '@/features/loans/pages/LoanCollectionsPage'

// Per-loan Collections workspace ("cockpit"). All Record-payment entry points
// across the app route here; `?action=record&cycleId=<uuid>` auto-opens the
// dialog seeded with that cycle. `?focusTxn=<uuid>` (from the Confirmations
// worklist) scrolls to and pulses that transaction row so the admin lands on
// its Confirm/Fail buttons.
interface CollectionsSearch {
  action?: 'record'
  cycleId?: string
  focusTxn?: string
}

export const Route = createFileRoute('/_authed/finances/$loanId/collections')({
  staticData: { title: 'Collections workspace' },
  validateSearch: (raw: Record<string, unknown>): CollectionsSearch => {
    const action = raw.action === 'record' ? 'record' : undefined
    const cycleId =
      typeof raw.cycleId === 'string' && raw.cycleId.length > 0 ? raw.cycleId : undefined
    const focusTxn =
      typeof raw.focusTxn === 'string' && raw.focusTxn.length > 0 ? raw.focusTxn : undefined
    return { action, cycleId, focusTxn }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { loanId } = Route.useParams()
  return <LoanCollectionsPage loanId={loanId} />
}
