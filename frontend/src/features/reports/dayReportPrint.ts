import type { DayReport, DayReportDay } from '@/api/queries/reports'
import { fmtDate, fmtINR } from '@/lib/format'
import { ORG_NAME } from '@/features/loans/branding'

const inr = (s: string) => fmtINR(Number(s))

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function daySection(day: DayReportDay): string {
  let sno = 0
  const receiptRows = day.receipts
    .map(
      (r) => `<tr>
        <td>${++sno}</td>
        <td>${esc(r.customer_name)}</td>
        <td class="mono">${esc(r.hp_number ?? r.loan_number)}</td>
        <td>${r.transaction_type === 'DOWN_PAYMENT' ? 'Down payment' : r.cycle_number != null ? `EMI · cycle #${r.cycle_number}` : 'EMI'} · ${esc(r.payment_mode)}</td>
        <td>${esc(r.collected_by)}</td>
        <td class="num pos">${inr(r.amount)}</td>
        <td class="num">—</td>
      </tr>`,
    )
    .join('')
  const paymentRows = day.payments
    .map(
      (p) => `<tr>
        <td>${++sno}</td>
        <td>${esc(p.customer_name)}</td>
        <td class="mono">${esc(p.hp_number ?? p.loan_number)}</td>
        <td>${esc(p.description)}</td>
        <td>—</td>
        <td class="num">—</td>
        <td class="num neg">${inr(p.amount)}</td>
      </tr>`,
    )
    .join('')

  return `<section class="day">
    <h2>${fmtDate(day.date)}</h2>
    <table>
      <thead>
        <tr><th>#</th><th>Name</th><th>HP No</th><th>Description</th><th>By</th><th class="num">Receipt</th><th class="num">Payment</th></tr>
      </thead>
      <tbody>
        <tr class="hl"><td></td><td><b>OPENING POSITION</b></td><td>—</td><td>—</td><td>—</td><td class="num"><b>${inr(day.opening_balance)}</b></td><td class="num">—</td></tr>
        ${receiptRows}
        ${paymentRows}
        <tr class="hl"><td></td><td><b>TOTAL</b></td><td colspan="3">EMI ${inr(day.emi_collection)} · Down payments ${inr(day.down_payments)}</td><td class="num pos"><b>${inr(day.total_receipts)}</b></td><td class="num neg"><b>${inr(day.total_payments)}</b></td></tr>
        <tr class="hl"><td></td><td><b>CLOSING POSITION</b></td><td colspan="3"></td><td class="num" colspan="2"><b>${inr(day.closing_balance)}</b></td></tr>
      </tbody>
    </table>
  </section>`
}

/**
 * Compose a printable day-report (single day or range) and hand it to the
 * browser's print dialog — same no-backend, no-dependency approach as the
 * loan statement.
 */
export function printDayReport(report: DayReport): void {
  const single = report.date1 === report.date2
  const title = single
    ? `Day Report — ${fmtDate(report.date1)}`
    : `Day Report — ${fmtDate(report.date1)} to ${fmtDate(report.date2)}`

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 15px; margin: 18px 0 6px; }
  .org { font-size: 13px; color: #555; margin-bottom: 2px; }
  .sub { font-size: 12px; color: #555; margin: 2px 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  th { background: #f2f2f2; }
  .num { text-align: right; }
  .mono { font-family: 'Courier New', monospace; }
  .pos { color: #0a7d33; }
  .neg { color: #b3261e; }
  .hl { background: #fafafa; }
  .summary { margin: 10px 0 4px; font-size: 12px; }
  .day { page-break-inside: avoid; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
  <div class="org">${esc(ORG_NAME)}</div>
  <h1>${esc(title)}</h1>
  <p class="sub">Opening ${inr(report.opening_balance)} · Receipts ${inr(report.total_receipts)} · Payments ${inr(report.total_payments)} · Closing ${inr(report.closing_balance)}<br/>
  Modes: Cash ${inr(report.cash)} · GPay ${inr(report.gpay)} · PhonePe ${inr(report.phonepe)} · Bank ${inr(report.bank_transfer)} · Other ${inr(report.other)}</p>
  ${report.days.length === 0 ? '<p>No activity in this period.</p>' : report.days.map(daySection).join('')}
  <p class="sub">Position = collections − disbursements (expenses/capital not tracked). Generated ${new Date().toLocaleString()}.</p>
</body>
</html>`

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000')
  if (!win) {
    // Popup blocked — fall back to a downloadable HTML file the user can open/print.
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DayReport_${report.date1}${single ? '' : `_${report.date2}`}.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.onload = () => win.print()
}
