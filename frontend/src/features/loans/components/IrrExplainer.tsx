import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardOutlined'

import { fmtINRApprox } from '@/lib/format'
import {
  amortSchedule,
  annualIrrPct,
  avgOutstanding,
  loanCashflow,
  type LoanTerms,
} from '../irrMath'
import { AmortScheduleTable } from './AmortScheduleTable'
import { Collapsible } from './Collapsible'
import { IrrBalanceChart, IrrChartLegend } from './IrrBalanceChart'

// The flat-vs-true-rate band: headline comparison, the chart that explains it,
// and the schedule behind it. Shared by the wizard's projection panel (live, as
// the employee types) and the loan detail page's Interest card (saved loan), so
// the two can never tell the customer different stories.
//
// Renders nothing when the true rate can't be solved — a 0%-interest loan, or
// incomplete terms. Better to show no rate than a wrong or alarming one.

export interface IrrExplainerProps extends LoanTerms {
  /** The quoted flat rate, % p.a. — the number the customer was told. */
  flatRatePct: number
  /** Hidden when false (e.g. closed loans, where a forward schedule is moot). */
  showSchedule?: boolean
}

export function IrrExplainer({ flatRatePct, showSchedule = true, ...terms }: IrrExplainerProps) {
  const rows = amortSchedule(terms)
  const truePct = annualIrrPct(loanCashflow(terms))
  const avg = avgOutstanding(rows)

  if (rows.length === 0 || truePct === null || avg === null) return null

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1.5 }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Flat rate (quoted)
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 600, fontSize: 16 }}>
            {flatRatePct.toFixed(2)}%
          </Typography>
        </Box>
        <ArrowForwardIcon sx={{ color: 'text.disabled', fontSize: 18 }} />
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            True rate (on reducing balance)
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 700, fontSize: 18 }}>
            {truePct.toFixed(2)}%
          </Typography>
        </Box>
      </Stack>

      <IrrBalanceChart rows={rows} principal={terms.principal} />
      <IrrChartLegend rows={rows} principal={terms.principal} />

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        Interest is charged on the full {fmtINRApprox(terms.principal)} for all {terms.tenureMonths}{' '}
        months, but the customer repays as they go — on average they owe only {fmtINRApprox(avg)},
        about half. Same interest on half the money, so the rate against what they actually owe is{' '}
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {truePct.toFixed(2)}%
        </Box>
        . The EMI does not change.
      </Typography>

      {showSchedule && (
        <Box sx={{ mt: 2 }}>
          <Collapsible title={`Show repayment schedule (${rows.length} rows)`}>
            <AmortScheduleTable rows={rows} />
          </Collapsible>
        </Box>
      )}
    </Box>
  )
}
