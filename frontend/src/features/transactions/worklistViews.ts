import dayjs from 'dayjs'

import type { WorklistParams } from '@/api/queries/dueCycles'

// The three operational lenses on the collections worklist. Kept out of the
// route module so the page doesn't import back from routes.
export const WORKLIST_VIEWS = ['due', 'upcoming', 'all'] as const
export type WorklistView = (typeof WORKLIST_VIEWS)[number]

export const WORKLIST_VIEW_LABELS: Record<WorklistView, string> = {
  due: 'Due & overdue',
  upcoming: 'Upcoming · 7 days',
  all: 'All unpaid',
}

// Translate a view into the backend filter params. Every view is unpaid-only
// (a worklist is about money still owed); they differ on the due-date window.
export function viewToParams(view: WorklistView): Partial<WorklistParams> {
  const today = dayjs()
  switch (view) {
    case 'due':
      return { unpaid_only: true, due_before: today.format('YYYY-MM-DD') }
    case 'upcoming':
      return {
        unpaid_only: true,
        due_after: today.add(1, 'day').format('YYYY-MM-DD'),
        due_before: today.add(7, 'day').format('YYYY-MM-DD'),
      }
    case 'all':
      return { unpaid_only: true }
  }
}
