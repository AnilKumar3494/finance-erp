import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/')({
  staticData: { title: 'Dashboard' },
  component: () => <ComingSoonPage module="Dashboard" />,
})
