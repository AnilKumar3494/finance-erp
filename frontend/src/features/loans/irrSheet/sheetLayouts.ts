import dayjs from 'dayjs'
import type { Cell, SheetRow } from './ExcelSheet'
import type { IrrSheetModel } from './irrSheetModel'

// Builds the three workbook tabs (Input / Amort / DV) as ExcelSheet grids from a
// single IrrSheetModel, live-populated. Layout and styling mirror the original
// IRR CAL SHEET.xls; the values are the loan's own.

// --- formatters ---------------------------------------------------------------
const gi = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : Math.round(n).toLocaleString('en-IN')
const g2 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? ''
    : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`

// --- cell shorthands ----------------------------------------------------------
const lbl = (text: string): Cell => ({ text, align: 'right', size: 11 })
const val = (text: string, fill?: Cell['fill']): Cell => ({
  text,
  align: 'right',
  box: true,
  fill,
  size: 11,
})
const note = (text: string): Cell => ({ text, align: 'left', size: 11 })
const blank: Cell = { text: '' }

// ============================================================ INPUT ==========

// One editable field on the calculator page: current raw string + setter.
export interface EditField {
  value: string
  onChange: (v: string) => void
}

// The fields the calculator lets you type into. Everything else on the sheet is
// derived (outputs) or out of scope (structured-deal rows, fixed at 0).
export interface InputSheetEdit {
  assetCost: EditField
  netFinance: EditField
  flatRate: EditField
  tenure: EditField
  startDate: EditField
  clientName: EditField
}

// An editable value cell: the workbook's blue fill is the "type here" signal.
const editVal = (f: EditField, type: 'number' | 'date' = 'number', placeholder?: string): Cell => ({
  align: 'right',
  box: true,
  fill: 'blue',
  size: 11,
  input: { value: f.value, onChange: f.onChange, type, placeholder },
})

export function inputSheetRows(m: IrrSheetModel, edit?: InputSheetEdit): SheetRow[] {
  const irr = pct(m.dealIrrPct)
  // 8 columns: leftLabel, leftVal, spacer, midVal, midNote, spacer, rightLabel, rightVal
  const rows: SheetRow[] = [
    [
      lbl('Asset Cost :'),
      edit ? editVal(edit.assetCost, 'number', 'optional') : val(gi(m.assetCost)),
      blank,
      blank,
      blank,
      blank,
      { text: 'Deal IRR :', align: 'right', bold: true },
      { text: irr, align: 'right', box: true, bold: true },
    ],
    [
      lbl('Net Finance :'),
      edit ? editVal(edit.netFinance) : val(gi(m.netFinance)),
      blank,
      val('0'),
      note(': Upfront disc.'),
      blank,
      { text: "Client's IRR :", align: 'right', bold: true },
      { text: irr, align: 'right', box: true, bold: true },
    ],
    [
      lbl('Flat Rate :'),
      edit ? editVal(edit.flatRate) : val(String(m.flatRatePct)),
      blank,
      val('0'),
      note(': Credit Pd.'),
      blank,
      blank,
      blank,
    ],
    [
      lbl('PPD :'),
      val('0'),
      blank,
      val('0'),
      note(': Credit Days Value'),
      blank,
      lbl('Exposure :'),
      val(pct(m.exposurePct)),
    ],
    [
      lbl('Tenure :'),
      edit ? editVal(edit.tenure) : val(String(m.tenureMonths)),
      blank,
      note('No'),
      note(': Margin Money to us'),
      blank,
      lbl('Disbursement Amt. :'),
      val(gi(m.disbursement)),
    ],
    [
      lbl('No. of Instl. :'),
      val(String(m.numInstalments)),
      blank,
      note('No'),
      note(': Adv EMI to us'),
      blank,
      lbl('Interest Amt. :'),
      val(gi(m.totalInterest)),
    ],
    [
      lbl('Instl. In Adv. :'),
      val('0'),
      blank,
      val('0'),
      note(": Disc't Rate"),
      blank,
      lbl('Agreement Value :'),
      val(gi(m.agreementValue)),
    ],
    [
      lbl('Moritorium :'),
      val('0'),
      blank,
      blank,
      note(': Agmt. Date'),
      blank,
      lbl("Total Instlm't :"),
      val(gi(m.agreementValue)),
    ],
    [
      lbl('Mgmt. Fee :'),
      val('0'),
      blank,
      edit ? { ...editVal(edit.startDate, 'date'), span: 2 } : blank,
      edit ? null : blank,
      blank,
      lbl('EMI Amount :'),
      val(gi(m.emi)),
    ],
    ...(edit
      ? [
          [
            blank,
            blank,
            blank,
            { text: ': First EMI Due Date', align: 'left', size: 11, span: 2 } as Cell,
            null,
            blank,
            blank,
            blank,
          ] as SheetRow,
        ]
      : []),
    [lbl('Loading :'), val('0'), blank, blank, blank, blank, lbl('Instl. Amt. 1 :'), val('0')],
    [blank, blank, blank, blank, blank, blank, lbl('Instl. Amt. 2 :'), val('0')],
    [blank, blank, blank, blank, blank, blank, lbl('Instl. Amt. 3 :'), val('0')],
    [blank, blank, blank, blank, blank, blank, lbl('Instl. Amt. 4 :'), val('0')],
    [blank, blank, blank, blank, blank, blank, lbl('Instl. Amt. 5 :'), val('0')],
    [blank, blank, blank, blank, blank, blank, blank, blank],
    [
      { text: 'Client Name:', align: 'right', span: 2 },
      null,
      edit
        ? {
            span: 6,
            underline: true,
            align: 'left',
            size: 11,
            input: {
              value: edit.clientName.value,
              onChange: edit.clientName.onChange,
              type: 'text',
              placeholder: 'optional',
            },
          }
        : { text: '', span: 6, underline: true },
      null,
      null,
      null,
      null,
      null,
    ],
    [
      { text: 'Group Name:', align: 'right', span: 2 },
      null,
      { text: '', span: 6, underline: true },
      null,
      null,
      null,
      null,
      null,
    ],
    [blank, blank, blank, blank, blank, blank, blank, blank],
    [
      { text: 'Proposed By', align: 'center', italic: true, span: 2 },
      null,
      { text: 'Recommended By', align: 'center', italic: true, span: 3 },
      null,
      null,
      { text: 'Approved By', align: 'center', italic: true, span: 3 },
      null,
      null,
    ],
  ]
  return rows
}

// Kept compact so the whole Input sheet — inputs on the left, the IRR/EMI
// outputs on the right — fits the loan-detail card without the outputs being
// pushed off-screen. The middle "notes" column carries only structured-deal
// labels (all 0/No here), so it takes the squeeze.
export const INPUT_COLS = [96, 58, 6, 22, 86, 6, 116, 62]

// ============================================================ AMORT ==========
export function amortSheetRows(m: IrrSheetModel): SheetRow[] {
  const start = m.startDate ? dayjs(m.startDate) : null
  const info: SheetRow[] = [
    [
      { text: 'Amortisation Schedule', bold: true, size: 13, span: 6 },
      null,
      null,
      null,
      null,
      null,
    ],
    [
      lbl('Name'),
      { text: m.customerName ?? '—', bold: true, span: 2, box: true },
      null,
      blank,
      blank,
      blank,
    ],
    [lbl('Location'), { text: m.location ?? '—', span: 2, box: true }, null, blank, blank, blank],
    [lbl('Loan Amt'), val(gi(m.netFinance)), blank, blank, blank, blank],
    [lbl('EMI'), val(gi(m.emi)), blank, blank, blank, blank],
    [lbl('No. of EMI'), val(String(m.tenureMonths)), blank, blank, blank, blank],
    [lbl('No. of Adv EMI'), val('0'), blank, blank, blank, blank],
    [
      lbl('Agreement no.'),
      { text: m.agreementNo ?? '—', span: 2, box: true },
      null,
      blank,
      blank,
      blank,
    ],
    [lbl('Agreement Rate'), val(pct(m.dealIrrPct)), blank, blank, blank, blank],
    [
      lbl('PDC Start Date'),
      { text: start ? start.format('DD-MMM-YYYY') : '—', box: true, align: 'right' },
      blank,
      blank,
      blank,
      blank,
    ],
    [blank, blank, blank, blank, blank, blank],
  ]

  const header: SheetRow = [
    { text: 'No. of EMI', fill: 'header', bold: true, align: 'center', size: 10 },
    { text: 'Repay Date', fill: 'header', bold: true, align: 'center', size: 10 },
    { text: 'EMI Amount', fill: 'header', bold: true, align: 'right', size: 10 },
    { text: 'Principal Portion', fill: 'header', bold: true, align: 'right', size: 10 },
    { text: 'Interest Portion', fill: 'header', bold: true, align: 'right', size: 10 },
    { text: 'Outstanding after EMI', fill: 'header', bold: true, align: 'right', size: 10 },
  ]

  const body: SheetRow[] = m.schedule.map((r) => {
    const emiThis = r.n === m.tenureMonths ? m.finalEmi : m.emi
    const date = start ? start.add(r.n - 1, 'month') : null
    return [
      { text: String(r.n), align: 'center', box: true, size: 11 },
      { text: date ? date.format('DD-MMM-YYYY') : '—', box: true, size: 11 },
      { text: g2(emiThis), align: 'right', box: true, size: 11 },
      { text: g2(r.principal), align: 'right', box: true, size: 11 },
      { text: g2(r.interest), align: 'right', box: true, size: 11 },
      { text: g2(r.balance), align: 'right', box: true, size: 11 },
    ]
  })

  const totalPrincipal = m.schedule.reduce((a, r) => a + r.principal, 0)
  const totalInterest = m.schedule.reduce((a, r) => a + r.interest, 0)
  const totalRow: SheetRow = [
    blank,
    { text: 'TOTAL', align: 'center', bold: true, box: true },
    { text: '', box: true },
    { text: g2(totalPrincipal), align: 'right', bold: true, box: true },
    { text: g2(totalInterest), align: 'right', bold: true, box: true },
    { text: '', box: true },
  ]

  return [...info, header, ...body, totalRow]
}

export const AMORT_COLS = [80, 110, 90, 110, 100, 130]

// ============================================================ DV =============
export function dvSheetRows(m: IrrSheetModel): SheetRow[] {
  const yrs = (m.tenureMonths / 12).toFixed(m.tenureMonths % 12 === 0 ? 0 : 2)
  const box2: Cell = { text: '', span: 2, box: true }
  const rows: SheetRow[] = [
    [
      { text: 'Disbursment Checklist', bold: true, size: 13, align: 'center', span: 4 },
      null,
      null,
      null,
    ],
    [blank, blank, blank, blank],
    [{ text: 'Product', box: true }, { text: 'Vehicle', box: true, span: 3 }, null, null],
    [
      { text: 'Customer Name', box: true },
      { text: m.customerName ?? '—', box: true, span: 3 },
      null,
      null,
    ],
    [{ text: 'Category', box: true }, box2, null, blank],
    [{ text: 'Model', box: true }, box2, null, blank],
    [{ text: 'Dealer', box: true }, box2, null, blank],
    [{ text: 'Source', box: true }, box2, null, blank],
    [blank, blank, blank, blank],
    [{ text: 'Finance Details', bold: true, align: 'center', span: 4 }, null, null, null],
    [
      note('Invoice Amt.:'),
      val(gi(m.assetCost)),
      lbl('Adv / Arrear:'),
      { text: 'Arrear', underline: true },
    ],
    [
      note('Margin Amt.:'),
      val(m.assetCost ? gi(m.assetCost - m.netFinance) : ''),
      lbl('Moritorium (Days):'),
      val('0'),
    ],
    [note('Discount:'), val('0'), lbl('No. of Adv EMI:'), val('0')],
    [note('Tenure (in Yrs):'), val(yrs), lbl('Credit Days:'), val('0')],
    [
      note('EMI Pattern:'),
      { text: 'Monthly', underline: true, align: 'right' },
      lbl('Credit Amt:'),
      val('0'),
    ],
    [blank, blank, blank, blank],
    [note('Service Charges'), val(gi(m.fees)), blank, blank],
    [note('IRR'), val(pct(m.dealIrrPct)), blank, blank],
    [blank, blank, blank, blank],
    [{ text: 'Disbursment Details:', bold: true, span: 4 }, null, null, null],
    [note('a) Finance Amt.'), val(gi(m.netFinance)), blank, blank],
    [note('b) Add- Margin'), val('0'), blank, blank],
    [note('c) Less- Adv EMI'), val('0'), blank, blank],
    [note('d) Less- Dealer Disc.'), val('0'), blank, blank],
    [note('e) Service Charges'), val(gi(m.fees)), blank, blank],
    [blank, blank, blank, blank],
    [
      { text: 'Total Disbursement', bold: true },
      { text: gi(m.disbursement), bold: true, align: 'right', box: true },
      blank,
      blank,
    ],
    [blank, blank, blank, blank],
    [{ text: '* Payment to be made in favour of', italic: true, span: 4 }, null, null, null],
    [{ text: '', underline: true, span: 4 }, null, null, null],
    [
      note('Disb Date'),
      { text: '', underline: true },
      note('Checked By'),
      { text: '', underline: true },
    ],
  ]
  return rows
}

export const DV_COLS = [150, 130, 150, 130]
