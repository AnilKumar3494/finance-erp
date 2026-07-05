import { jsPDF } from 'jspdf'

import { ORG_NAME } from '@/features/loans/branding'
import { fmtDateTime } from '@/lib/format'

// jsPDF's built-in Helvetica is WinAnsi-encoded and has no ₹ glyph (U+20B9),
// so PDF money is written with an ASCII prefix instead of reusing fmtINR.
const inrNumber = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
export const pdfINR = (v: string | number) => {
  const n = Number(v)
  // Negated zero fields would otherwise print as "Rs -0.00".
  return `Rs ${inrNumber.format(n === 0 ? 0 : n)}`
}

const MARGIN = 40
const HEADER_GAP = 26
const ROW_H = 15
const TABLE_FONT = 8.5

interface Frame {
  doc: jsPDF
  left: number
  right: number
  width: number
  bottom: number
}

function newDoc(orientation: 'portrait' | 'landscape'): Frame {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation })
  const pageWidth = doc.internal.pageSize.getWidth()
  return {
    doc,
    left: MARGIN,
    right: pageWidth - MARGIN,
    width: pageWidth - MARGIN * 2,
    // Keep clear of the footer stamped on every page.
    bottom: doc.internal.pageSize.getHeight() - 56,
  }
}

// Branded page header; returns the y where content starts.
function drawHeader(f: Frame, title: string, subtitle?: string): number {
  const { doc, left, right } = f
  let y = 50
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(0)
  doc.text(ORG_NAME, left, y)
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(110)
  doc.text(title, right, y, { align: 'right' })
  y += 10
  doc.setDrawColor(180).setLineWidth(0.8).line(left, y, right, y)
  if (subtitle) {
    y += 16
    doc.setFontSize(9).setTextColor(110)
    doc.text(subtitle, left, y)
  }
  doc.setTextColor(0)
  return y + HEADER_GAP
}

// Footer on every page: generated timestamp + page numbers.
function stampFooters(f: Frame) {
  const { doc, left, right } = f
  const pageCount = doc.getNumberOfPages()
  const y = doc.internal.pageSize.getHeight() - 34
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setDrawColor(210).setLineWidth(0.5).line(left, y - 10, right, y - 10)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130)
    doc.text(`Generated ${fmtDateTime(new Date())}`, left, y)
    doc.text(`Page ${p} of ${pageCount}`, right, y, { align: 'right' })
  }
  doc.setTextColor(0)
}

// Shrink text to fit a column, ellipsised. Assumes font size is already set.
function fit(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

// Wrapped grey note paragraph; starts a new page if fewer than 3 lines fit.
function drawNote(f: Frame, y: number, note: string): void {
  const { doc, left, width, bottom } = f
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(110)
  const lines = doc.splitTextToSize(note, width) as string[]
  if (y + lines.length * 11 > bottom && y + 33 > bottom) {
    doc.addPage()
    y = 56
  }
  doc.text(lines, left, y + 6)
  doc.setTextColor(0)
}

// --------------------------------------------------
// Table report (HP Outstanding / Register / interest reports)
// --------------------------------------------------
export interface PdfTableColumn {
  header: string
  /** Fraction of the usable page width (fractions are normalised). */
  width: number
  align?: 'left' | 'right'
}

export function downloadTablePdf({
  filename,
  title,
  subtitle,
  orientation = 'portrait',
  columns,
  rows,
  totals,
  note,
}: {
  filename: string
  title: string
  subtitle?: string
  orientation?: 'portrait' | 'landscape'
  columns: PdfTableColumn[]
  rows: string[][]
  /** Optional bold summary row, aligned with `columns` ('' for blank cells). */
  totals?: string[]
  note?: string
}): void {
  const f = newDoc(orientation)
  const { doc, left, bottom } = f

  const totalFraction = columns.reduce((a, c) => a + c.width, 0)
  const widths = columns.map((c) => (c.width / totalFraction) * f.width)
  const xs: number[] = []
  let acc = left
  for (const w of widths) {
    xs.push(acc)
    acc += w
  }
  const PAD = 4

  const cellX = (i: number) => (columns[i].align === 'right' ? xs[i] + widths[i] - PAD : xs[i] + PAD)

  const drawHeadRow = (y: number): number => {
    doc.setFillColor(240, 242, 245).rect(left, y - 11, f.width, ROW_H + 2, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(TABLE_FONT)
    columns.forEach((c, i) =>
      doc.text(fit(doc, c.header, widths[i] - PAD * 2), cellX(i), y, {
        align: c.align ?? 'left',
      }),
    )
    doc.setFont('helvetica', 'normal')
    return y + ROW_H + 2
  }

  let y = drawHeader(f, title, subtitle)
  y = drawHeadRow(y)
  doc.setFontSize(TABLE_FONT)

  for (const row of rows) {
    if (y > bottom) {
      doc.addPage()
      y = drawHeadRow(62)
      doc.setFontSize(TABLE_FONT)
    }
    row.forEach((cell, i) =>
      doc.text(fit(doc, cell, widths[i] - PAD * 2), cellX(i), y, {
        align: columns[i].align ?? 'left',
      }),
    )
    y += ROW_H
  }

  if (totals) {
    if (y > bottom) {
      doc.addPage()
      y = drawHeadRow(62)
    }
    doc.setDrawColor(120).setLineWidth(0.7).line(left, y - 10, f.right, y - 10)
    doc.setFont('helvetica', 'bold').setFontSize(TABLE_FONT)
    totals.forEach((cell, i) => {
      if (cell) doc.text(fit(doc, cell, widths[i] - PAD * 2), cellX(i), y, { align: columns[i].align ?? 'left' })
    })
    doc.setFont('helvetica', 'normal')
    y += ROW_H
  }

  if (note) drawNote(f, y, note)
  stampFooters(f)
  doc.save(filename)
}

// --------------------------------------------------
// Statement report (P&L, Balance Sheet) — label/value lines in sections
// --------------------------------------------------
export interface StatementLine {
  label: string
  /** Already-formatted value; '' renders a label-only line (e.g. empty-state). */
  value: string
  bold?: boolean
  indent?: boolean
}

export interface StatementSection {
  heading: string
  lines: StatementLine[]
}

export function downloadStatementPdf({
  filename,
  title,
  subtitle,
  sections,
  note,
}: {
  filename: string
  title: string
  subtitle?: string
  sections: StatementSection[]
  note?: string
}): void {
  const f = newDoc('portrait')
  const { doc, left, right, bottom } = f
  const LINE_H = 19

  let y = drawHeader(f, title, subtitle)

  const ensureRoom = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage()
      y = 62
    }
  }

  for (const section of sections) {
    ensureRoom(LINE_H * 2)
    doc.setFillColor(240, 242, 245).rect(left, y - 12, f.width, LINE_H, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(10)
    doc.text(section.heading, left + 6, y + 1)
    y += LINE_H + 4

    doc.setFontSize(9.5)
    for (const line of section.lines) {
      ensureRoom(LINE_H)
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
      doc.setTextColor(line.bold ? 0 : 60)
      doc.text(line.label, left + (line.indent ? 22 : 6), y)
      if (line.value) doc.text(line.value, right - 6, y, { align: 'right' })
      if (line.bold) {
        doc.setDrawColor(150).setLineWidth(0.6).line(left, y - 13, right, y - 13)
      }
      y += LINE_H - 3
    }
    doc.setTextColor(0)
    y += 10
  }

  if (note) drawNote(f, y, note)
  stampFooters(f)
  doc.save(filename)
}
