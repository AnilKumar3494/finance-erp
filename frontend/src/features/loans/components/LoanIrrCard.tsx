import Typography from '@mui/material/Typography'

import type { LoanResponse } from '@/api/queries/loans'
import { useDueCycles } from '@/api/queries/dueCycles'
import { useVehicle } from '@/api/queries/vehicles'
import { Spinner } from '@/components/primitives'
import { baseEmisOf, loanIrrTerms } from '../loanIrrTerms'
import { IrrSheetView } from '../irrSheet/IrrSheetView'
import type { IrrSheetInput } from '../irrSheet/irrSheetModel'

// The IRR CAL SHEET rendered for a loan.
//
// An APPROVED loan has real due cycles, so build the terms from those (their
// base EMIs carry the rounding stub — see loanIrrTerms). A DRAFT has no cycles
// yet, but its principal / rate / tenure are already entered, so fall back to
// those exactly as the wizard does. Either way the sheet renders; only a loan
// with no terms at all shows the placeholder.
export function LoanIrrCard({ loan }: { loan: LoanResponse }) {
  const cycles = useDueCycles(loan.id)
  const vehicle = useVehicle(loan.vehicle_id ?? undefined)

  if (cycles.isLoading) return <Spinner />

  const flatRatePct = Number(loan.interest_rate ?? NaN)
  const principal = Number(loan.principal ?? NaN)
  const tenure = Number(loan.tenure ?? NaN)
  const results = cycles.data?.results ?? []

  // Shared context regardless of which terms source we use.
  const context = {
    assetCost: vehicle.data?.market_value ? Number(vehicle.data.market_value) : null,
    customerName: loan.customer?.full_name ?? null,
    location: loan.customer?.mandal_village ?? null,
    agreementNo: loan.hp_number ?? null,
    fees:
      Number(loan.processing_fee ?? 0) +
      Number(loan.documentation_fee ?? 0) +
      Number(loan.dsc_fee ?? 0) +
      Number(loan.rto_fee ?? 0),
  }

  let input: IrrSheetInput | null = null
  const cycleTerms = loanIrrTerms(loan, baseEmisOf(results))
  if (cycleTerms) {
    // Approved: real schedule. First cycle's due date is the real PDC start.
    const firstDue =
      [...results].sort((a, b) => a.cycle_number - b.cycle_number)[0]?.due_date ??
      loan.approval_date
    input = {
      principal: cycleTerms.principal,
      flatRatePct,
      tenureMonths: cycleTerms.tenureMonths,
      emi: cycleTerms.emi,
      finalEmi: cycleTerms.finalEmi,
      startDate: firstDue,
      ...context,
    }
  } else if (
    Number.isFinite(principal) &&
    Number.isFinite(flatRatePct) &&
    Number.isFinite(tenure) &&
    principal > 0 &&
    tenure > 0
  ) {
    // Draft (or any loan without cycles): compute from the entered terms; the EMI
    // is derived from the flat-rate projection, matching what the wizard shows.
    input = {
      principal,
      flatRatePct,
      tenureMonths: tenure,
      startDate: loan.approval_date,
      ...context,
    }
  }

  if (!input) {
    return (
      <Typography variant="body2" color="text.secondary">
        The IRR sheet needs the loan's principal, rate and tenure — add them in the finance terms
        first.
      </Typography>
    )
  }

  return <IrrSheetView input={input} />
}
