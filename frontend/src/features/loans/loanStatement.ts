import type { LoanResponse } from '@/api/queries/loans'
import type { DueCycleResponse } from '@/api/queries/dueCycles'
import type { LoanTransactionSummary, TransactionResponse } from '@/api/queries/transactions'
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format'
import { ORG_NAME } from './branding'
import { loanDisplayId } from './loanIdentity'
import { CYCLE_STATUS_META } from './cycleStatusMeta'
import { LOAN_STATUS_META } from './loanStatusMeta'
import { PAYMENT_METHOD_LABELS } from './paymentMethodLabels'

const TXN_TYPE_LABELS: Record<TransactionResponse['transaction_type'], string> = {
  REGULAR: 'Regular',
  DOWN_PAYMENT: 'Down payment',
}
const TXN_STATUS_LABELS: Record<TransactionResponse['status'], string> = {
  PENDING: 'Pending',
  SUCCESS: 'Success',
  FAILED: 'Failed',
}

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(v: string | null | undefined): string {
  return v === null || v === undefined ? '—' : fmtINR(Number(v))
}

function defRow(label: string, value: string): string {
  return `<div class="def"><span class="def-l">${esc(label)}</span><span class="def-v">${value}</span></div>`
}

// Compose a printable per-loan statement (loan terms + summary + due-cycle
// ledger + transactions) and hand it to the browser's print dialog, where the
// user can save it as a PDF. No backend endpoint and no new dependency — built
// from data already cached on the loan-detail page.
export function printLoanStatement({
  loan,
  cycles,
  transactions,
  summary,
}: {
  loan: LoanResponse
  cycles: DueCycleResponse[]
  transactions: TransactionResponse[]
  summary?: LoanTransactionSummary | null
}): void {
  const customerName = loan.customer?.full_name ?? '—'
  const customerMobile = loan.customer?.mobile_number ?? '—'
  const vehicle = loan.vehicle
    ? [loan.vehicle.plate_number, loan.vehicle.make, loan.vehicle.model].filter(Boolean).join(' · ')
    : '—'

  const cycleRows = cycles
    .map(
      (c) => `<tr>
        <td>${c.cycle_number}</td>
        <td>${esc(fmtDate(c.due_date))}</td>
        <td class="num">${money(c.total_due)}</td>
        <td class="num">${money(c.total_received)}</td>
        <td class="num">${money(c.shortfall)}</td>
        <td>${esc(CYCLE_STATUS_META[c.cycle_status]?.label ?? c.cycle_status)}</td>
      </tr>`,
    )
    .join('')

  const txnRows = transactions
    .map(
      (t) => `<tr>
        <td>${esc(fmtDate(t.effective_payment_date))}</td>
        <td class="num">${money(t.amount)}</td>
        <td>${esc(PAYMENT_METHOD_LABELS[t.payment_mode])}</td>
        <td>${esc(TXN_TYPE_LABELS[t.transaction_type])}</td>
        <td>${esc(TXN_STATUS_LABELS[t.status])}</td>
      </tr>`,
    )
    .join('')

  const summaryBlock = summary
    ? `<div class="summary">
        ${defRow('Total payable', money(summary.total_payable))}
        ${defRow('Total paid', money(summary.total_paid))}
        ${defRow('Pending', money(summary.total_pending))}
        ${defRow('Outstanding', `<strong>${money(summary.outstanding)}</strong>`)}
      </div>`
    : ''

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Statement ${esc(loanDisplayId(loan))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 32px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 13px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .muted { color: #777; }
  .meta { text-align: right; font-size: 11px; color: #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-top: 12px; }
  .def { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dotted #eee; }
  .def-l { color: #777; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; }
  th { background: #f5f7fa; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #555; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; color: #999; font-size: 10px; }
  @media print { body { margin: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${esc(ORG_NAME)}</h1>
      <div class="muted">Loan Statement</div>
    </div>
    <div class="meta">
      Finance: <strong>${esc(loanDisplayId(loan))}</strong><br/>
      ${loan.hp_number ? `<span class="muted">LMS: ${esc(loan.loan_number)}</span><br/>` : ''}
      Status: ${esc(LOAN_STATUS_META[loan.status]?.label ?? loan.status)}
    </div>
  </div>

  <div class="grid">
    ${defRow('Customer', esc(customerName))}
    ${defRow('Mobile', esc(customerMobile))}
    ${defRow('Vehicle', esc(vehicle))}
    ${defRow('Approval date', esc(loan.approval_date ? fmtDate(loan.approval_date) : '—'))}
    ${defRow('Principal', money(loan.principal))}
    ${defRow('Interest rate', loan.interest_rate ? `${esc(loan.interest_rate)}%` : '—')}
    ${defRow('Tenure', loan.tenure ? `${loan.tenure} months` : '—')}
    ${defRow('Total payable', money(loan.total_payable))}
  </div>

  ${summaryBlock ? `<h2>Account summary</h2>${summaryBlock}` : ''}

  <h2>Due cycles</h2>
  ${
    cycles.length
      ? `<table>
    <thead><tr><th>#</th><th>Due date</th><th class="num">Due</th><th class="num">Received</th><th class="num">Shortfall</th><th>Status</th></tr></thead>
    <tbody>${cycleRows}</tbody>
  </table>`
      : '<div class="muted">No due cycles yet.</div>'
  }

  <h2>Transactions</h2>
  ${
    transactions.length
      ? `<table>
    <thead><tr><th>Date</th><th class="num">Amount</th><th>Mode</th><th>Type</th><th>Status</th></tr></thead>
    <tbody>${txnRows}</tbody>
  </table>`
      : '<div class="muted">No transactions recorded.</div>'
  }

  <div class="foot">
    <span>Generated ${esc(fmtDateTime(new Date()))}</span>
    <span>Computer-generated statement — ${esc(ORG_NAME)}</span>
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000')
  if (!win) {
    // Popup blocked — fall back to a downloadable HTML file the user can open/print.
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Statement_${loanDisplayId(loan)}.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Let the new document lay out before invoking print.
  win.onload = () => win.print()
}
