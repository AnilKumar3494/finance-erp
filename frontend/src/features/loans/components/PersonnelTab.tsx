import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import type { ChipProps } from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  useLoanPersonnel,
  type LoanPersonnelResponse,
} from '@/api/queries/personnel'
import { ErrorBanner, Spinner } from '@/components/primitives'
import type { PersonnelRole } from '@/schemas/enums'

const ROLE_META: Record<
  PersonnelRole,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  GUARANTOR: { label: 'Guarantor', color: 'info' },
  CO_HIRER: { label: 'Co-hirer', color: 'default' },
}

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 403) return 'You do not have access to this personnel.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading guarantors and co-hirers.'
}

export function PersonnelTab({ loanId }: { loanId: string }) {
  const query = useLoanPersonnel(loanId)

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner size={26} />
      </Box>
    )
  }
  if (query.isError) {
    return <ErrorBanner message={mapError(query.error)} />
  }

  const rows = query.data?.results ?? []
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No guarantors or co-hirers linked to this loan.
      </Typography>
    )
  }

  return (
    <Stack spacing={1.5}>
      {rows.map((row) => (
        <PersonnelRow key={row.id} row={row} />
      ))}
    </Stack>
  )
}

function PersonnelRow({ row }: { row: LoanPersonnelResponse }) {
  const meta = ROLE_META[row.role]
  const p = row.personnel
  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {p.full_name}
        </Typography>
        <Chip size="small" label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, fontFamily: 'var(--font-mono)' }}
      >
        {p.mobile_number}
      </Typography>
      {row.relationship_to_hirer && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Relationship: {row.relationship_to_hirer}
        </Typography>
      )}
    </Box>
  )
}
