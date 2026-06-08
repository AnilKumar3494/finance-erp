import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { useEmployeeReport } from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import type { UserRole } from '@/schemas/enums'
import { fmtINR } from '@/lib/format'
import { money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  EMPLOYEE: 'Employee',
}

export function EmployeesTab() {
  const report = useEmployeeReport()

  return (
    <AsyncSection isLoading={report.isLoading} isError={report.isError} error={report.error}>
      {report.data && (
        <Stack spacing={3}>
          <Box sx={KPI_GRID_SX}>
            <KpiCard label="Employees" value={String(report.data.total_employees)} />
            <KpiCard
              label="Total collected"
              value={fmtINR(money(report.data.total_collections))}
              accent="success.main"
            />
            <KpiCard label="Transactions" value={String(report.data.total_transactions)} />
          </Box>

          {report.data.results.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No employee activity to report.
            </Typography>
          ) : (
            <Card sx={{ p: 0, overflow: 'hidden' }}>
              <TableContainer>
                <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Employee</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Assigned</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Collected</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.data.results.map((e) => (
                      <TableRow key={e.employee_id}>
                        <TableCell>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <span>{e.employee_name}</span>
                            {!e.is_active && (
                              <Chip size="small" label="Former" variant="outlined" />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>{ROLE_LABELS[e.role]}</TableCell>
                        <TableCell align="right">{e.assigned_customers}</TableCell>
                        <TableCell align="right">{e.transaction_count}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {fmtINR(money(e.total_collections))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          )}
        </Stack>
      )}
    </AsyncSection>
  )
}
