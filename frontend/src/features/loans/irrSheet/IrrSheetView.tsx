import { useState } from 'react'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'

import { ExcelSheet } from './ExcelSheet'
import { buildIrrSheetModel, type IrrSheetInput } from './irrSheetModel'
import {
  AMORT_COLS,
  DV_COLS,
  INPUT_COLS,
  amortSheetRows,
  dvSheetRows,
  inputSheetRows,
} from './sheetLayouts'

// The IRR CAL SHEET rendered in the app: the workbook's Input / Amort / DV tabs,
// faithful in layout but populated with this loan's own numbers. Replaces the
// earlier chart+caption explainer per the client's request.
//
// Renders nothing when the inputs can't form a valid loan (a DRAFT with no
// terms, a 0%-interest loan) so callers can drop it in unconditionally.
export function IrrSheetView({ input }: { input: IrrSheetInput }) {
  const [tab, setTab] = useState(0)
  const model = buildIrrSheetModel(input)
  if (!model) return null

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

      {tab === 0 && (
        <Box sx={{ background: '#d9d9d9', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
          <ExcelSheet rows={inputSheetRows(model)} colWidths={INPUT_COLS} minWidth={452} />
        </Box>
      )}
      {tab === 1 && (
        <ExcelSheet rows={amortSheetRows(model)} colWidths={AMORT_COLS} minWidth={620} />
      )}
      {tab === 2 && <ExcelSheet rows={dvSheetRows(model)} colWidths={DV_COLS} minWidth={560} />}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Reproduces the IRR CAL SHEET with this loan's figures. Flat {model.flatRatePct}% ={' '}
        {model.dealIrrPct == null ? '—' : `${model.dealIrrPct.toFixed(2)}%`} true (reducing-balance)
        rate.
      </Typography>
    </Box>
  )
}
