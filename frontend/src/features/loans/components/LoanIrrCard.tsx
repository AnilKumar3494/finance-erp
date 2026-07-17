import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { Spinner } from '@/components/primitives'
import { annualIrrPct, loanCashflow } from '../irrMath'
import { baseEmisOf, loanIrrTerms } from '../loanIrrTerms'
import { IrrExplainer } from './IrrExplainer'

// The true-rate view for a SAVED loan, built from its real due cycles — see
// loanIrrTerms for why the cycles and not the headline principal/emi/tenure.
export function LoanIrrCard({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)

  if (cycles.isLoading) return <Spinner />

  const flatRatePct = Number(loan.interest_rate ?? NaN)
  const terms = loanIrrTerms(loan, baseEmisOf(cycles.data?.results ?? []))

  if (terms === null || !Number.isFinite(flatRatePct)) {
    return (
      <Typography variant="body2" color="text.secondary">
        The true rate needs the loan's terms and its EMI schedule — available once the loan is
        approved.
      </Typography>
    )
  }

  if (annualIrrPct(loanCashflow(terms)) === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        This loan carries no interest, so there is no reducing-balance rate to show.
      </Typography>
    )
  }

  return <IrrExplainer {...terms} flatRatePct={flatRatePct} />
}
