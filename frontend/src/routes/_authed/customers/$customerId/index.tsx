import { createFileRoute } from '@tanstack/react-router'

import { CustomerDetailPage } from '@/features/customers/pages/CustomerDetailPage'

export const Route = createFileRoute('/_authed/customers/$customerId/')({
  staticData: { title: 'Customer Detail' },
  component: RouteComponent,
})

function RouteComponent() {
  const { customerId } = Route.useParams()
  return <CustomerDetailPage customerId={customerId} />
}
