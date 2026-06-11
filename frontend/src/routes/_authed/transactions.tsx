import { createFileRoute } from '@tanstack/react-router'

import { CollectionsWorklistPage } from '@/features/transactions/pages/CollectionsWorklistPage'
import { WORKLIST_VIEWS, type WorklistView } from '@/features/transactions/worklistViews'

interface WorklistSearch {
  view: WorklistView
  search?: string
  page: number
}

export const Route = createFileRoute('/_authed/transactions')({
  staticData: { title: 'Collections & Actions' },
  validateSearch: (raw: Record<string, unknown>): WorklistSearch => {
    const view =
      typeof raw.view === 'string' && (WORKLIST_VIEWS as readonly string[]).includes(raw.view)
        ? (raw.view as WorklistView)
        : 'due'
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const page = Number(raw.page)
    return {
      view,
      search,
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    }
  },
  component: CollectionsWorklistPage,
})
