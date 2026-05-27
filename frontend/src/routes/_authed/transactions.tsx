import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/transactions')({
  staticData: { title: 'Transactions' },
  component: () => <ComingSoonPage module="Transactions" />,
})
