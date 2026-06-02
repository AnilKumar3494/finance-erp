import { createFileRoute } from '@tanstack/react-router'

import { CustomerEditPage } from '@/features/customers/pages/CustomerEditPage'

export const Route = createFileRoute('/_authed/customers/$customerId/edit')({
  staticData: { title: 'Edit customer' },
  component: RouteComponent,
})

function RouteComponent() {
  const { customerId } = Route.useParams()
  return <CustomerEditPage customerId={customerId} />
}
