import { createFileRoute } from '@tanstack/react-router'

import { VehicleCreatePage } from '@/features/vehicles/pages/VehicleCreatePage'

export const Route = createFileRoute('/_authed/vehicles/new')({
  staticData: { title: 'New Vehicle' },
  component: VehicleCreatePage,
})
