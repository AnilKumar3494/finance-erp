import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import { useLoan } from '@/api/queries/loans'
import { useDocuments } from '@/api/queries/documents'
import { Card, ErrorBanner, Spinner } from '@/components/primitives'
import { FileUpload } from '@/components/FileUpload'

// Customer-with-vehicle photos are VEHICLE_PHOTO documents carrying both the
// customer and the vehicle (per the backend's doc model). They require the
// vehicle to exist first (created in the Vehicle step).
export function PhotosSection({
  financeId,
  customerId,
}: {
  financeId: string
  customerId: string
}) {
  const loanQuery = useLoan(financeId)

  if (loanQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (loanQuery.isError || !loanQuery.data) {
    return <ErrorBanner message="Could not load this finance." />
  }

  const vehicleId = loanQuery.data.vehicle_id
  if (!vehicleId) {
    return (
      <Card>
        <Typography variant="h3" sx={{ mb: 1 }}>
          Customer with Vehicle
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Add a vehicle in the Vehicle step before uploading customer-with-vehicle photos.
        </Typography>
      </Card>
    )
  }

  return <PhotosCard vehicleId={vehicleId} customerId={customerId} />
}

function PhotosCard({ vehicleId, customerId }: { vehicleId: string; customerId: string }) {
  const docsQuery = useDocuments({ vehicle_id: vehicleId, doc_type: 'VEHICLE_PHOTO', page_size: 100 })
  const photos = docsQuery.data?.results ?? []
  const [uploadKey, setUploadKey] = useState(0)

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Customer with Vehicle
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Upload photos of the customer with the vehicle. You can add more than one.
      </Typography>

      {docsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <Spinner size={22} />
        </Box>
      ) : (
        <Stack spacing={2}>
          {photos.length > 0 && (
            <Stack spacing={1}>
              {photos.map((p) => (
                <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
                  <Typography variant="body2" color="text.secondary">
                    {p.file_name ?? 'Photo'}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
          <FileUpload
            key={uploadKey}
            customerId={customerId}
            vehicleId={vehicleId}
            docType="VEHICLE_PHOTO"
            hint="Add a customer-with-vehicle photo"
            onUploaded={() => setUploadKey((k) => k + 1)}
          />
        </Stack>
      )}
    </Card>
  )
}
