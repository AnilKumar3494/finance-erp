import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined'

import { Btn, Card } from '@/components/primitives'
import { VehicleForm } from '../components/VehicleForm'

// Standalone vehicle registration. Defaults to type=INVENTORY / status=IN_YARD
// (the Finance wizard handles the COLLATERAL / WITH_CUSTOMER path separately).
export function VehicleCreatePage() {
  const navigate = useNavigate()

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center' }}>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate({ to: '/vehicles', search: { page: 1 } })}
        >
          Vehicles
        </Btn>
      </Stack>

      <Card>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Register a Vehicle
        </Typography>
        <VehicleForm
          mode="create"
          onCreated={(vehicle) =>
            navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: vehicle.id } })
          }
          onCancel={() => navigate({ to: '/vehicles', search: { page: 1 } })}
        />
      </Card>
    </Box>
  )
}
