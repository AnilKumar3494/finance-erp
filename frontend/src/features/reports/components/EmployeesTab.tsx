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

import { useState } from 'react'

import { useEmployeeReport, type EmployeePerformance } from '@/api/queries/reports'
import { Card } from '@/components/primitives'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
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

type EmpField = 'employee' | 'role' | 'assigned' | 'txns' | 'collected'

const EMP_ACCESSORS: Partial<Record<EmpField, (e: EmployeePerformance) => string | number | null>> = {
  employee: (e) => e.employee_name,
  role: (e) => ROLE_LABELS[e.role],
  assigned: (e) => e.assigned_customers,
  txns: (e) => e.transaction_count,
  collected: (e) => money(e.total_collections),
}

export function EmployeesTab() {
  const report = useEmployeeReport()
  const [sort, setSort] = useState<SortState<EmpField>>({ sort_by: 'collected', sort_order: 'desc' })
  const onSort = (field: EmpField, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))
  const rows = useClientSort(report.data?.results ?? [], sort.sort_by, sort.sort_order, EMP_ACCESSORS)

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
                      <SortableTh field="employee" label="Employee" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                      <SortableTh field="role" label="Role" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                      <SortableTh field="assigned" label="Assigned" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      <SortableTh field="txns" label="Txns" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      <SortableTh field="collected" label="Collected" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((e) => (
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
