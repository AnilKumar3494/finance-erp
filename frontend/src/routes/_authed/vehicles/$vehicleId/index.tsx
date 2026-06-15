import { createFileRoute } from '@tanstack/react-router'

import { VehicleDetailPage } from '@/features/vehicles/pages/VehicleDetailPage'

export const Route = createFileRoute('/_authed/vehicles/$vehicleId/')({
  staticData: { title: 'Vehicle detail' },
  component: RouteComponent,
})

function RouteComponent() {
  const { vehicleId } = Route.useParams()
  return <VehicleDetailPage vehicleId={vehicleId} />
}
