import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useVehicle } from '@/api/queries/vehicles'
import { Spinner } from '@/components/primitives'
import { annualIrrPct, loanCashflow } from '../irrMath'
import { baseEmisOf, loanIrrTerms } from '../loanIrrTerms'
import { IrrSheetView } from '../irrSheet/IrrSheetView'

// The IRR CAL SHEET rendered for a SAVED loan, built from its real due cycles —
// see loanIrrTerms for why the cycles and not the headline principal/emi/tenure.
export function LoanIrrCard({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)
  const vehicle = useVehicle(loan.vehicle_id ?? undefined)

  if (cycles.isLoading) return <Spinner />

  const flatRatePct = Number(loan.interest_rate ?? NaN)
  const results = cycles.data?.results ?? []
  const terms = loanIrrTerms(loan, baseEmisOf(results))

  if (terms === null || !Number.isFinite(flatRatePct)) {
    return (
      <Typography variant="body2" color="text.secondary">
        The IRR sheet needs the loan's terms and its EMI schedule — available once the loan is
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

  // The first cycle's due date is the real PDC start; fall back to approval.
  const firstDue =
    [...results].sort((a, b) => a.cycle_number - b.cycle_number)[0]?.due_date ?? loan.approval_date

  return (
    <IrrSheetView
      input={{
        principal: terms.principal,
        flatRatePct,
        tenureMonths: terms.tenureMonths,
        emi: terms.emi,
        finalEmi: terms.finalEmi,
        assetCost: vehicle.data?.market_value ? Number(vehicle.data.market_value) : null,
        customerName: loan.customer?.full_name ?? null,
        location: loan.customer?.mandal_village ?? null,
        agreementNo: loan.hp_number ?? null,
        startDate: firstDue,
        fees: Number(loan.processing_fee ?? 0) + Number(loan.documentation_fee ?? 0),
      }}
    />
  )
}
