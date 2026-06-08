import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined'

import { downloadCustomerReportCsv, useCustomerReport } from '@/api/queries/reports'
import { Btn, Card, ErrorBanner } from '@/components/primitives'
import { fmtINR } from '@/lib/format'
import { mapReportError, money } from '../reportUtils'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'

const PAGE_SIZE = 50

export function CustomersReportTab() {
  const [page, setPage] = useState(1)
  const report = useCustomerReport(page, PAGE_SIZE)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const total = report.data?.total_customers ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1

  const onExport = async () => {
    setExportError(null)
    setExporting(true)
    try {
      await downloadCustomerReportCsv()
    } catch (e) {
      setExportError(mapReportError(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          Per-customer outstanding across open loans, highest first.
        </Typography>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={<DownloadIcon />}
          onClick={onExport}
          loading={exporting}
        >
          Export CSV
        </Btn>
      </Stack>

      {exportError && <ErrorBanner message={exportError} />}

      <AsyncSection isLoading={report.isLoading} isError={report.isError} error={report.error}>
        {report.data && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard label="Customers" value={String(report.data.total_customers)} />
              <KpiCard
                label="With active loans"
                value={String(report.data.customers_with_active_loans)}
              />
            </Box>

            {report.data.results.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No customers to report.
              </Typography>
            ) : (
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Mobile</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Active loans</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Principal</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Paid</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Outstanding</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.data.results.map((c) => (
                        <TableRow key={c.customer_id}>
                          <TableCell>{c.customer_name}</TableCell>
                          <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                            {c.mobile_number}
                          </TableCell>
                          <TableCell align="right">{c.active_loans}</TableCell>
                          <TableCell align="right">{fmtINR(money(c.total_principal))}</TableCell>
                          <TableCell align="right">{fmtINR(money(c.total_paid))}</TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontWeight: 600,
                              color: money(c.total_outstanding) > 0 ? 'error.main' : undefined,
                            }}
                          >
                            {fmtINR(money(c.total_outstanding))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}

            {total > 0 && (
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}
              >
                <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ‹ Prev
                </Btn>
                <Typography variant="body2" color="text.secondary">
                  Page {page} of {totalPages} · {total} customer{total === 1 ? '' : 's'}
                </Typography>
                <Btn
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next ›
                </Btn>
              </Stack>
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
