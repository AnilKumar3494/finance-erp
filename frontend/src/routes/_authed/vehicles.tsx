import { createFileRoute } from '@tanstack/react-router'

import { ComingSoonPage } from '@/features/_shell/pages/ComingSoonPage'

export const Route = createFileRoute('/_authed/vehicles')({
  staticData: { title: 'Vehicles' },
  component: () => <ComingSoonPage module="Vehicles" />,
})
