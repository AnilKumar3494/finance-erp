// Client-side CSV download for report tables whose rows are already in
// memory (the HP reports return every row in one response). The customers
// report keeps its server-streamed export — that one can be 100k rows.

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','))
  // BOM so Excel opens it as UTF-8 (₹, Telugu names).
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
