import { createFileRoute } from '@tanstack/react-router'

import { CustomerCreatePage } from '@/features/customers/pages/CustomerCreatePage'

export const Route = createFileRoute('/_authed/customers/new')({
  staticData: { title: 'New Customer' },
  component: CustomerCreatePage,
})
