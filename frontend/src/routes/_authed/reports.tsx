import { createFileRoute } from '@tanstack/react-router'

import { ReportsPage } from '@/features/reports/pages/ReportsPage'
import { REPORT_TABS, type ReportTab } from '@/features/reports/tabs'

interface ReportsSearch {
  tab: ReportTab
}

export const Route = createFileRoute('/_authed/reports')({
  staticData: { title: 'Reports' },
  validateSearch: (raw: Record<string, unknown>): ReportsSearch => {
    const tab =
      typeof raw.tab === 'string' && (REPORT_TABS as readonly string[]).includes(raw.tab)
        ? (raw.tab as ReportTab)
        : 'overview'
    return { tab }
  },
  component: ReportsPage,
})
