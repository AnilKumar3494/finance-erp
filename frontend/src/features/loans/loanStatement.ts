import type { LoanResponse } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'
import type { VehicleResponse } from '@/api/queries/vehicles'
import type { LoanPersonnelResponse } from '@/api/queries/personnel'
import type { DueCycleResponse } from '@/api/queries/dueCycles'
import type { LoanTransactionSummary, TransactionResponse } from '@/api/queries/transactions'
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format'
import { ORG_NAME } from './branding'
import { loanDisplayId } from './loanIdentity'
import { LOAN_STATUS_META } from './loanStatusMeta'

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : fmtINR(Number(v))
}

// Address as the old iFinance file printed it: everything on the person's
// record, comma-joined, blanks dropped.
function addressOf(p: {
  address_line_1?: string | null
  address_line_2?: string | null
  mandal_village?: string | null
  pincode?: string | null
}): string {
  const parts = [p.address_line_1, p.address_line_2, p.mandal_village, p.pincode].filter(
    (s): s is string => !!s && s.trim() !== '',
  )
  return parts.length ? parts.join(', ') : '—'
}

// A labelled line inside one of the three detail columns.
function line(label: string, value: string): string {
  return `<div class="ln"><span class="lbl">${esc(label)}</span> ${value}</div>`
}

// Whole days `later` falls after `earlier` (never negative). Both are ISO dates.
function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier).getTime()
  const b = new Date(later).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export interface LoanStatementData {
  loan: LoanResponse
  cycles: DueCycleResponse[]
  transactions: TransactionResponse[]
  summary?: LoanTransactionSummary | null
  customer?: CustomerResponse | null
  vehicle?: VehicleResponse | null
  personnel?: LoanPersonnelResponse[]
}

// Compose a printable customer statement in the layout of the old iFinance
// "file summary" the owner's customers already recognise: customer / guarantor
// / vehicle blocks, the finance summary line, then the EMI schedule with paid
// tracking. No backend endpoint and no new dependency — built from data cached
// on the detail page. Returns a self-contained HTML document string; the caller
// shows it in an in-app preview (iframe) and prints from there, so there is no
// pop-up to be blocked.
//
// The IRR / true-rate view is deliberately NOT here — that stays on-screen
// (the Interest card). This document is what goes to the customer.
export function buildLoanStatementHtml({
  loan,
  cycles,
  transactions,
  summary,
  customer,
  vehicle,
  personnel,
}: LoanStatementData): string {
  const customerName = customer?.full_name ?? loan.customer?.full_name ?? '—'
  const customerMobile = customer?.mobile_number ?? loan.customer?.mobile_number ?? '—'
  const customerAddress = customer ? addressOf(customer) : '—'

  const guarantor = (personnel ?? []).find((p) => p.role === 'GUARANTOR')?.personnel

  // Paid tracking per cycle: sum received and take the latest payment date from
  // the transactions booked against that cycle (transactions carry due_cycle_id).
  const paidByCycle = new Map<string, { received: number; lastDate: string | null }>()
  for (const t of transactions) {
    if (!t.due_cycle_id || t.status !== 'SUCCESS') continue
    const cur = paidByCycle.get(t.due_cycle_id) ?? { received: 0, lastDate: null }
    cur.received += Number(t.amount)
    if (!cur.lastDate || t.effective_payment_date > cur.lastDate) {
      cur.lastDate = t.effective_payment_date
    }
    paidByCycle.set(t.due_cycle_id, cur)
  }

  // Flat monthly interest, shown in parentheses beside each EMI exactly as the
  // iFinance sheet did (constant every month, not a reducing-balance split).
  const flatMonthlyInterest = loan.monthly_interest ? money(loan.monthly_interest) : null

  const ordered = [...cycles].sort((a, b) => a.cycle_number - b.cycle_number)

  const cycleRows = ordered
    .map((c) => {
      const paid = paidByCycle.get(c.id)
      const amountCell = flatMonthlyInterest
        ? `${money(c.base_emi)} <span class="paren">(${flatMonthlyInterest})</span>`
        : money(c.base_emi)
      const paidDate = paid?.lastDate ? esc(fmtDate(paid.lastDate)) : '—'
      const paidAmt = paid ? money(String(paid.received)) : '—'
      // Overdue days: if paid, how late the payment landed; if still unpaid and
      // past due, how long it has been outstanding.
      const receivedEnough = Number(c.total_received) >= Number(c.total_due)
      let days = 0
      if (paid?.lastDate) days = daysBetween(c.due_date, paid.lastDate)
      else if (!receivedEnough) days = daysBetween(c.due_date, new Date().toISOString())
      // Status is derived from THIS row's own numbers so it can never contradict
      // the Days OD or Paid columns beside it. We do NOT use cycle_status: for
      // migrated loans it is stale (stamped PAID_ON_TIME even where the real
      // payment date, recovered later, was well past due).
      let statusLabel: string
      if (receivedEnough) statusLabel = days > 0 ? `Paid · ${days}d late` : 'Paid on time'
      else if (Number(c.total_received) > 0) statusLabel = 'Part paid'
      else if (days > 0) statusLabel = 'Overdue'
      else statusLabel = 'Upcoming'
      return `<tr>
        <td>${c.cycle_number}</td>
        <td>${esc(fmtDate(c.due_date))}</td>
        <td class="num">${amountCell}</td>
        <td>${paidDate}</td>
        <td class="num">${paidAmt}</td>
        <td class="num">${days || ''}</td>
        <td>${esc(statusLabel)}</td>
      </tr>`
    })
    .join('')

  const totalDue = ordered.reduce((a, c) => a + Number(c.total_due), 0)
  const totalReceived = ordered.reduce((a, c) => a + Number(c.total_received), 0)
  const outstanding = summary ? Number(summary.outstanding) : totalDue - totalReceived
  const interest =
    loan.total_payable && loan.principal
      ? Number(loan.total_payable) - Number(loan.principal)
      : null

  const vehicleReg = vehicle?.plate_number ?? loan.vehicle?.plate_number ?? '—'
  const vehicleMake = vehicle?.make ?? loan.vehicle?.make ?? null
  const vehicleModel = vehicle?.model ?? loan.vehicle?.model ?? null

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Statement ${esc(loanDisplayId(loan))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 28px; font-size: 12px; }
  .topbar { display: flex; justify-content: space-between; font-size: 11px; color: #666; }
  h1 { font-size: 20px; margin: 2px 0 18px; text-align: center; letter-spacing: .02em; }
  .cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-bottom: 6px; }
  .col h2 { font-size: 12px; margin: 0 0 6px; color: #2a5fb0; letter-spacing: .04em; }
  .ln { padding: 2px 0; line-height: 1.4; }
  .lbl { font-weight: 700; text-transform: uppercase; font-size: 10.5px; color: #333; }
  .status { text-align: center; font-weight: 700; letter-spacing: .06em; margin: 18px 0 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e6e6e6; }
  th { background: #f5f7fa; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #555; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .paren { color: #888; font-size: 11px; }
  .summary th, .summary td { border-bottom: 1px solid #d0d0d0; }
  .summary tfoot td { font-weight: 700; border-top: 2px solid #1a1a1a; }
  tfoot td { font-weight: 700; }
  .foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; color: #999; font-size: 10px; }
  @media print { body { margin: 0; } @page { margin: 14mm; } thead { display: table-header-group; } }
</style>
</head>
<body>
  <div class="topbar">
    <span>${esc(fmtDateTime(new Date()))}</span>
    <span>${esc(loanDisplayId(loan))}</span>
  </div>
  <h1>${esc(ORG_NAME)}</h1>

  <div class="cols">
    <div class="col">
      <h2>CUSTOMER DETAILS</h2>
      ${line('HP No:', esc(loan.hp_number))}
      ${line('Name:', esc(customerName))}
      ${line('Mobile:', esc(customerMobile))}
      ${line('Address:', esc(customerAddress))}
    </div>
    <div class="col">
      <h2>GUARANTOR DETAILS</h2>
      ${
        guarantor
          ? `${line('Name:', esc(guarantor.full_name))}
             ${line('Mobile:', esc(guarantor.mobile_number))}
             ${line('Address:', esc(addressOf(guarantor)))}`
          : '<div class="ln">—</div>'
      }
    </div>
    <div class="col">
      <h2>VEHICLE DETAILS</h2>
      ${line('Reg No:', esc(vehicleReg))}
      ${line('Make:', esc(vehicleMake))}
      ${line('Model:', esc(vehicleModel))}
      ${line('Chassis No:', esc(vehicle?.chassis_number))}
      ${line('Engine No:', esc(vehicle?.engine_number))}
    </div>
  </div>

  <div class="status">FILE STATUS — ${esc((LOAN_STATUS_META[loan.status]?.label ?? loan.status).toUpperCase())}</div>

  <table class="summary">
    <thead>
      <tr>
        <th>Agreement Date</th>
        <th class="num">Finance Amt</th>
        <th class="num">Interest</th>
        <th class="num">Total</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(loan.approval_date ? fmtDate(loan.approval_date) : '—')}</td>
        <td class="num">${money(loan.principal)}</td>
        <td class="num">${interest === null ? '—' : money(String(interest))}</td>
        <td class="num">${money(loan.total_payable)}</td>
        <td class="num">${money(String(outstanding))}</td>
      </tr>
    </tbody>
  </table>

  <table>
    <thead>
      <tr>
        <th>SNo</th>
        <th>Due Date</th>
        <th class="num">Amount</th>
        <th>Paid Date</th>
        <th class="num">Paid Amount</th>
        <th class="num">Days OD</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${cycleRows || '<tr><td colspan="7" style="color:#999">No EMI schedule yet.</td></tr>'}
    </tbody>
    ${
      ordered.length
        ? `<tfoot>
      <tr>
        <td>Total</td><td></td>
        <td class="num">${money(String(totalDue))}</td>
        <td></td>
        <td class="num">${money(String(totalReceived))}</td>
        <td></td><td></td>
      </tr>
      <tr>
        <td colspan="4">HP Total EMI Balance</td>
        <td class="num">${money(String(outstanding))}</td>
        <td></td><td></td>
      </tr>
    </tfoot>`
        : ''
    }
  </table>

  <div class="foot">
    <span>Generated ${esc(fmtDateTime(new Date()))}</span>
    <span>Computer-generated statement — ${esc(ORG_NAME)}</span>
  </div>
</body>
</html>`

  return html
}
