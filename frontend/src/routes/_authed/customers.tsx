import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/customers')({
  staticData: { title: 'Customers' },
  component: () => <ComingSoonPage module="Customers" />,
})
