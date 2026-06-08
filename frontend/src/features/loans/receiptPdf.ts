import { jsPDF } from 'jspdf'

import type { LoanResponse } from '@/api/queries/loans'
import type { LoanTransactionSummary, TransactionResponse } from '@/api/queries/transactions'
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from './paymentMethodLabels'

const ORG_NAME = 'Finance ERP'

const TXN_TYPE_LABELS: Record<TransactionResponse['transaction_type'], string> = {
  REGULAR: 'Regular',
  DOWN_PAYMENT: 'Down payment',
}

// Short, human-friendly receipt reference from the transaction UUID.
function receiptNo(txn: TransactionResponse): string {
  return `RCPT-${txn.id.slice(0, 8).toUpperCase()}`
}

// Build a one-page payment receipt for a single (confirmed) transaction and
// trigger a browser download. No backend endpoint — composed entirely from
// data already on the loan-detail page. `summary` is optional; when present we
// print the loan's current outstanding balance.
export function downloadReceiptPdf({
  txn,
  loan,
  summary,
}: {
  txn: TransactionResponse
  loan: LoanResponse
  summary?: LoanTransactionSummary | null
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const left = 48
  const right = pageWidth - 48
  let y = 56

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(18).text(ORG_NAME, left, y)
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(110)
  doc.text('Payment Receipt', right, y, { align: 'right' })
  doc.setTextColor(0)
  y += 14
  doc.setDrawColor(210).line(left, y, right, y)
  y += 28

  // Receipt meta (right) + loan/customer (left)
  const customerName = loan.customer?.full_name ?? '—'
  const customerMobile = loan.customer?.mobile_number ?? '—'
  const vehicle = loan.vehicle?.plate_number ?? null

  doc.setFontSize(10).setTextColor(110)
  doc.text(`Receipt no: ${receiptNo(txn)}`, right, y, { align: 'right' })
  doc.text(`Date: ${fmtDate(txn.effective_payment_date)}`, right, y + 14, { align: 'right' })
  doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(11)
  doc.text('Received from', left, y)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.text(customerName, left, y + 16)
  doc.setFontSize(10).setTextColor(110)
  doc.text(customerMobile, left, y + 31)
  doc.setTextColor(0)
  y += 56

  // Loan reference line
  const ref = [`Finance: ${loan.loan_number}`, vehicle ? `Vehicle: ${vehicle}` : null]
    .filter(Boolean)
    .join('     ')
  doc.setFontSize(10).text(ref, left, y)
  y += 24

  // Amount block (boxed)
  doc.setFillColor(245, 247, 250).rect(left, y, right - left, 56, 'F')
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110)
  doc.text('Amount received', left + 16, y + 22)
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(0)
  doc.text(fmtINR(Number(txn.amount)), right - 16, y + 34, { align: 'right' })
  y += 56 + 28

  // Details table (label / value rows)
  const rows: Array<[string, string]> = [
    ['Payment mode', PAYMENT_METHOD_LABELS[txn.payment_mode]],
    ['Payment type', TXN_TYPE_LABELS[txn.transaction_type]],
    ['Status', txn.status === 'SUCCESS' ? 'Confirmed' : txn.status],
  ]
  if (txn.notes) rows.push(['Notes', txn.notes])
  if (summary) rows.push(['Outstanding balance', fmtINR(Number(summary.outstanding))])

  doc.setFontSize(10)
  for (const [label, value] of rows) {
    doc.setTextColor(110).text(label, left, y)
    doc.setTextColor(0).text(value, right, y, { align: 'right' })
    y += 22
  }

  // Footer
  y = doc.internal.pageSize.getHeight() - 64
  doc.setDrawColor(210).line(left, y, right, y)
  doc.setFontSize(9).setTextColor(130)
  doc.text(`Generated ${fmtDateTime(new Date())}`, left, y + 18)
  doc.text('This is a computer-generated receipt.', right, y + 18, { align: 'right' })

  doc.save(`${receiptNo(txn)}_${loan.loan_number}.pdf`)
}
