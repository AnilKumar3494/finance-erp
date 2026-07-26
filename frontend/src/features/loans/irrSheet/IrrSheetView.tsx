import { useState } from 'react'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'

import { ExcelSheet } from './ExcelSheet'
import { buildIrrSheetModel, type IrrSheetInput, type IrrSheetModel } from './irrSheetModel'
import {
  AMORT_COLS,
  DV_COLS,
  INPUT_COLS,
  amortSheetRows,
  dvSheetRows,
  inputSheetRows,
  type InputSheetEdit,
} from './sheetLayouts'

// A zeroed model so the editable calculator keeps rendering while the user is
// mid-edit (a cleared field must not make the whole sheet vanish). Outputs show
// 0 / — until the inputs form a valid deal again.
function emptyModel(input: IrrSheetInput): IrrSheetModel {
  return {
    assetCost: null,
    netFinance: 0,
    flatRatePct: 0,
    tenureMonths: 0,
    numInstalments: 0,
    fees: 0,
    monthlyInterest: 0,
    totalInterest: 0,
    agreementValue: 0,
    emi: 0,
    finalEmi: 0,
    disbursement: 0,
    dealIrrPct: null,
    exposurePct: null,
    avgOutstanding: null,
    schedule: [],
    customerName: input.customerName ?? null,
    location: input.location ?? null,
    agreementNo: input.agreementNo ?? null,
    startDate: input.startDate ?? null,
  }
}

// The IRR CAL SHEET rendered in the app: the workbook's Input / Amort / DV tabs,
// faithful in layout but populated with this loan's own numbers. Replaces the
// earlier chart+caption explainer per the client's request.
//
// Read-only mode (no `edit`): renders nothing when the inputs can't form a
// valid loan (a DRAFT with no terms, a 0%-interest loan) so callers can drop it
// in unconditionally. With `edit`, the workbook's blue input cells become live
// fields (the IRR Sheet calculator page) and the sheet always renders.
export function IrrSheetView({
  input,
  edit,
  fill,
}: {
  input: IrrSheetInput
  edit?: InputSheetEdit
  // Full-width mode for the standalone IRR Sheet page, where the sheet is the
  // whole point of the screen. Embedded uses (loan detail, wizard) stay at the
  // workbook's natural size so they don't dominate the card they sit in.
  fill?: boolean
}) {
  const [tab, setTab] = useState(0)
  const model = buildIrrSheetModel(input) ?? (edit ? emptyModel(input) : null)
  if (!model) return null
  // The workbook's own 12px is spreadsheet-dense; on the full-page calculator
  // there is width to spare, so the type goes up to comfortable reading size.
  // Padding, row height and the min-width floor all derive from this.
  const sheet = { fill, fontSize: fill ? 18 : undefined }

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 36, mb: 1.5, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
      >
        <Tab label="Input (IRR)" />
        <Tab label="Amortisation" />
        <Tab label="Disbursement" />
      </Tabs>

      {/* The sheets are always light "paper" — the cells carry dark spreadsheet
          text, so they must sit on a light surface in dark theme too, not the
          app's dark background (where the text would vanish). The Input tab keeps
          the workbook's grey canvas; the others are white. */}
      {tab === 0 && (
        <Box sx={{ background: '#d9d9d9', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
          <ExcelSheet
            rows={inputSheetRows(model, edit)}
            colWidths={INPUT_COLS}
            minWidth={452}
            {...sheet}
          />
        </Box>
      )}
      {tab === 1 && (
        <Box sx={{ background: '#fff', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
          <ExcelSheet
            rows={amortSheetRows(model)}
            colWidths={AMORT_COLS}
            minWidth={620}
            {...sheet}
          />
        </Box>
      )}
      {tab === 2 && (
        <Box sx={{ background: '#fff', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
          <ExcelSheet
            rows={dvSheetRows(model)}
            colWidths={DV_COLS}
            minWidth={560}
            {...sheet}
          />
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {edit
          ? 'Type in the blue cells — everything else recomputes live, including the Amortisation and Disbursement tabs.'
          : `Reproduces the IRR CAL SHEET with this loan's figures. Flat ${model.flatRatePct}% = ${
              model.dealIrrPct == null ? '—' : `${model.dealIrrPct.toFixed(2)}%`
            } true (reducing-balance) rate.`}
      </Typography>
    </Box>
  )
}
