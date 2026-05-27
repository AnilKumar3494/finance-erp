import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/reports')({
  staticData: { title: 'Reports' },
  component: () => <ComingSoonPage module="Reports" />,
})
