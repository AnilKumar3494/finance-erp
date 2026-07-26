import { createFileRoute } from '@tanstack/react-router'

import { CollectionsWorklistPage } from '@/features/transactions/pages/CollectionsWorklistPage'
import { WORKLIST_VIEWS, type WorklistView } from '@/features/transactions/worklistViews'

interface WorklistSearch {
  view: WorklistView
  search?: string
  assigned_to?: string
  // Inclusive date window, ISO YYYY-MM-DD. Which date it filters on depends on
  // the lens (EMI due date / payment date / proposal date) — see the page.
  date_from?: string
  date_to?: string
  page: number
}

// Accept only a well-formed ISO date; anything else is dropped so a hand-edited
// URL can't push garbage into an API query param.
const isoDate = (raw: unknown): string | undefined =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined

export const Route = createFileRoute('/_authed/transactions')({
  staticData: { title: 'Collections' },
  validateSearch: (raw: Record<string, unknown>): WorklistSearch => {
    const view =
      typeof raw.view === 'string' && (WORKLIST_VIEWS as readonly string[]).includes(raw.view)
        ? (raw.view as WorklistView)
        : 'due'
    const search = typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const assigned_to =
      typeof raw.assigned_to === 'string' && raw.assigned_to.length > 0
        ? raw.assigned_to
        : undefined
    const page = Number(raw.page)
    return {
      view,
      search,
      assigned_to,
      date_from: isoDate(raw.date_from),
      date_to: isoDate(raw.date_to),
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    }
  },
  component: CollectionsWorklistPage,
})
