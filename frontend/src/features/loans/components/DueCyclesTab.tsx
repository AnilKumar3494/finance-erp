import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { useDueCycles, type DueCycleResponse } from '@/api/queries/dueCycles'
import { ErrorBanner, Spinner } from '@/components/primitives'
import { fmtDate, fmtINR } from '@/lib/format'
import { CycleStatusChip } from './CycleStatusChip'

function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 403) return 'You do not have access to this schedule.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading the schedule.'
}

// Muted em-dash for a zero amount, formatted INR otherwise.
function amountOrDash(value: string) {
  return Number(value) > 0 ? fmtINR(Number(value)) : null
}

export function DueCyclesTab({ loanId }: { loanId: string }) {
  const query = useDueCycles(loanId)

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
        No due cycles yet. They are generated when the loan is approved.
      </Typography>
    )
  }

  return (
    <>
      <DesktopTable rows={rows} />
      <MobileCards rows={rows} />
    </>
  )
}

const Dash = () => (
  <Typography component="span" variant="body2" color="text.secondary">
    —
  </Typography>
)

function DesktopTable({ rows }: { rows: DueCycleResponse[] }) {
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Due date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Total due
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Received
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Shortfall
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Penalty
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((c) => {
              const shortfall = amountOrDash(c.shortfall)
              const penalty = amountOrDash(c.penalty_amount)
              return (
                <TableRow key={c.id}>
                  <TableCell>{c.cycle_number}</TableCell>
                  <TableCell>{fmtDate(c.due_date)}</TableCell>
                  <TableCell align="right">{fmtINR(Number(c.total_due))}</TableCell>
                  <TableCell align="right">{fmtINR(Number(c.total_received))}</TableCell>
                  <TableCell align="right" sx={{ color: shortfall ? 'error.main' : undefined }}>
                    {shortfall ?? <Dash />}
                  </TableCell>
                  <TableCell align="right">{penalty ?? <Dash />}</TableCell>
                  <TableCell>
                    <CycleStatusChip status={c.cycle_status} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

function MobileCards({ rows }: { rows: DueCycleResponse[] }) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
      {rows.map((c) => {
        const shortfall = amountOrDash(c.shortfall)
        return (
          <Box
            key={c.id}
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
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Cycle {c.cycle_number} · {fmtDate(c.due_date)}
              </Typography>
              <CycleStatusChip status={c.cycle_status} />
            </Stack>
            <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <LabelValue label="Due" value={fmtINR(Number(c.total_due))} />
              <LabelValue label="Received" value={fmtINR(Number(c.total_received))} />
              {shortfall && <LabelValue label="Shortfall" value={shortfall} danger />}
            </Stack>
          </Box>
        )
      })}
    </Stack>
  )
}

function LabelValue({
  label,
  value,
  danger = false,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: danger ? 'error.main' : undefined }}>
        {value}
      </Typography>
    </Box>
  )
}
