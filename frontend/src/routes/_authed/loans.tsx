import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/loans')({
  staticData: { title: 'Loans' },
  component: () => <ComingSoonPage module="Loans" />,
})
