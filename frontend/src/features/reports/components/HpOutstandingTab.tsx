import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import { useNavigate } from '@tanstack/react-router'

import { useHpOutstanding, type HpOutstandingRow } from '@/api/queries/reports'
import { Btn, Card, Input } from '@/components/primitives'
import { SortableTh } from '@/components/sort/SortableTh'
import { toggleSort, useClientSort, type SortState } from '@/components/sort/useTableSort'
import { fmtINR } from '@/lib/format'
import { AsyncSection } from './AsyncSection'
import { KPI_GRID_SX, KpiCard } from './KpiCard'
import { downloadCsv } from '../csvExport'

const inr = (s: string) => fmtINR(Number(s))

type Field = 'hp' | 'customer' | 'status' | 'principal' | 'payable' | 'collected' | 'outstanding'

const ACCESSORS: Partial<Record<Field, (r: HpOutstandingRow) => string | number | null>> = {
  hp: (r) => r.hp_number ?? r.loan_number,
  customer: (r) => r.customer_name,
  status: (r) => r.status,
  principal: (r) => Number(r.principal),
  payable: (r) => Number(r.payable),
  collected: (r) => Number(r.collected),
  outstanding: (r) => Number(r.outstanding),
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  AWAITING_CLOSURE: 'Awaiting closure',
  BAD_DEBT_PROPOSED: 'Bad debt proposed',
}

/**
 * HP Outstanding — the as-of-now ledger position of every open finance:
 * payable, collected, and outstanding per loan, with portfolio totals.
 */
export function HpOutstandingTab() {
  const query = useHpOutstanding()
  const report = query.data
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<Field>>({
    sort_by: 'outstanding',
    sort_order: 'desc',
  })
  const onSort = (field: Field, defaultDir: 'asc' | 'desc') =>
    setSort((s) => toggleSort(s, field, defaultDir))

  const filtered = useMemo(() => {
    const rows = report?.results ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.hp_number ?? r.loan_number).toLowerCase().includes(q),
    )
  }, [report, search])

  const rows = useClientSort(filtered, sort.sort_by, sort.sort_order, ACCESSORS)

  // Footer totals track the visible (filtered) rows; the KPI cards above stay
  // portfolio-wide.
  const sums = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          principal: a.principal + Number(r.principal),
          payable: a.payable + Number(r.payable),
          collected: a.collected + Number(r.collected),
          outstanding: a.outstanding + Number(r.outstanding),
        }),
        { principal: 0, payable: 0, collected: 0, outstanding: 0 },
      ),
    [rows],
  )

  const exportCsv = () =>
    downloadCsv(
      'hp_outstanding.csv',
      ['HP No', 'Customer', 'Status', 'Principal', 'Payable', 'Collected', 'Outstanding'],
      rows.map((r) => [
        r.hp_number ?? r.loan_number,
        r.customer_name,
        STATUS_LABELS[r.status] ?? r.status,
        r.principal,
        r.payable,
        r.collected,
        r.outstanding,
      ]),
    )

  return (
    <Stack spacing={3}>
      <AsyncSection isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {report && (
          <>
            <Box sx={KPI_GRID_SX}>
              <KpiCard label="Open finances" value={String(report.total_loans)} />
              <KpiCard label="Payable" value={inr(report.total_payable)} />
              <KpiCard
                label="Collected"
                value={inr(report.total_collected)}
                accent="success.main"
              />
              <KpiCard
                label="Outstanding"
                value={inr(report.total_outstanding)}
                accent="error.main"
              />
            </Box>

            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 220, maxWidth: 420 }}>
                <Input
                  id="hpo-search"
                  placeholder="Filter by customer or HP number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {rows.length} of {report.results.length} finances
              </Typography>
              <Btn variant="ghost" startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv}>
                Export CSV
              </Btn>
            </Stack>

            {rows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No open finances match this filter.
              </Typography>
            ) : (
              <Card sx={{ p: 0, overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table
                    size="small"
                    sx={{ minWidth: 860, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}
                  >
                    <TableHead>
                      <TableRow>
                        <SortableTh field="hp" label="HP No" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="customer" label="Customer" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="status" label="Status" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="asc" onSort={onSort} />
                        <SortableTh field="principal" label="Principal" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="payable" label="Payable" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="collected" label="Collected" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                        <SortableTh field="outstanding" label="Outstanding" align="right" activeField={sort.sort_by} activeOrder={sort.sort_order} defaultDir="desc" onSort={onSort} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow
                          key={r.loan_id}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() =>
                            navigate({ to: '/finances/$loanId', params: { loanId: r.loan_id } })
                          }
                        >
                          <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>
                            {r.hp_number ?? r.loan_number}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                              {r.customer_name}
                            </Typography>
                          </TableCell>
                          <TableCell>{STATUS_LABELS[r.status] ?? r.status}</TableCell>
                          <TableCell align="right">{inr(r.principal)}</TableCell>
                          <TableCell align="right">{inr(r.payable)}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>
                            {inr(r.collected)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                            {inr(r.outstanding)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 700 }}>TOTAL</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {fmtINR(sums.principal)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {fmtINR(sums.payable)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                          {fmtINR(sums.collected)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>
                          {fmtINR(sums.outstanding)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}
          </>
        )}
      </AsyncSection>
    </Stack>
  )
}
