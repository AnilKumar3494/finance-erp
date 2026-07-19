import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'
import { IrrSheetView } from '../irrSheet/IrrSheetView'
import type { InputSheetEdit } from '../irrSheet/sheetLayouts'

// The IRR CAL SHEET as a standalone what-if calculator: the workbook rendered
// with its blue input cells live, for pricing a deal that isn't booked yet
// (walk-ins at the counter). Nothing here is saved — booking a deal still goes
// through the New finance wizard.
//
// Seeded with the book's median product (a 21% flat, 12-month deal) so the
// sheet is alive on arrival instead of a wall of zeros.
export function IrrSheetPage() {
  const [netFinance, setNetFinance] = useState('50000')
  const [flatRate, setFlatRate] = useState('21')
  const [tenure, setTenure] = useState('12')
  const [assetCost, setAssetCost] = useState('')
  const [fees, setFees] = useState('')
  const [startDate, setStartDate] = useState('')
  const [clientName, setClientName] = useState('')

  const num = (s: string): number => {
    const t = s.trim()
    if (t === '') return NaN
    const n = Number(t)
    return Number.isFinite(n) ? n : NaN
  }

  const edit: InputSheetEdit = {
    netFinance: { value: netFinance, onChange: setNetFinance },
    flatRate: { value: flatRate, onChange: setFlatRate },
    tenure: { value: tenure, onChange: setTenure },
    assetCost: { value: assetCost, onChange: setAssetCost },
    fees: { value: fees, onChange: setFees },
    startDate: { value: startDate, onChange: setStartDate },
    clientName: { value: clientName, onChange: setClientName },
  }

  return (
    <Box sx={{ width: { xs: '100%', md: '80%' }, mx: 'auto' }}>
      <Card>
        <Typography variant="h2" sx={{ fontSize: { xs: 18, sm: 20 }, mb: 0.5 }}>
          IRR Sheet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Price a deal before it exists — enter the terms in the blue cells and read off the true
          (reducing-balance) rate, EMI, and schedule. Nothing is saved; to book the deal, use New
          finance.
        </Typography>
        <IrrSheetView
          input={{
            principal: num(netFinance),
            flatRatePct: num(flatRate),
            tenureMonths: num(tenure),
            assetCost: assetCost.trim() === '' ? null : num(assetCost),
            fees: fees.trim() === '' ? 0 : num(fees),
            startDate: startDate || null,
            customerName: clientName.trim() || null,
          }}
          edit={edit}
        />
      </Card>
    </Box>
  )
}
