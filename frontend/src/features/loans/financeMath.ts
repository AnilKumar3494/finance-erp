// Flat-rate finance projection — MIRRORS the backend (services/finance.py, the
// authority that generates the real schedule on approval) so the wizard's live
// estimate matches what the customer will actually be billed. Informational
// only: once saved, the loan exposes the authoritative total_payable /
// monthly_interest / per-cycle EMI and those are used wherever available.
//
// Backend scheme — flat interest on the GROSS principal. The down payment does
// NOT reduce the interest or the EMI: it is a prepayment recorded against the
// first cycle, so it lowers the outstanding balance but not the monthly figure.
//   monthly interest = round2( principal × rate% / 12 )
//   total payable    = round2( principal + monthly interest × tenure )
//   EMI (regular)    = round2( total payable / tenure )
//        (the final month absorbs the rounding remainder; not shown here)
//   net loan principal = principal − down payment   (informational — financed
//        amount after the down payment; does not feed the interest/EMI)
// Processing/documentation fees reduce the disbursed amount, not the EMI, so
// they're excluded here.

export interface FinanceProjection {
  netPrincipal: number
  totalInterest: number
  totalPayable: number
  emi: number
  monthlyInterest: number
}

export interface FinanceProjectionInput {
  principal: number
  annualRatePct: number
  tenureMonths: number
  downPayment?: number
}

// Round to paise. The backend uses banker's rounding (ROUND_HALF_EVEN); for an
// indicative estimate plain half-up is close enough and the saved loan's
// figures are authoritative anyway.
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

// Returns null unless principal, rate, and tenure are all present and valid
// (positive tenure/principal), so callers can simply skip rendering when inputs
// are incomplete.
export function flatRateProjection({
  principal,
  annualRatePct,
  tenureMonths,
  downPayment = 0,
}: FinanceProjectionInput): FinanceProjection | null {
  if (
    !Number.isFinite(principal) ||
    !Number.isFinite(annualRatePct) ||
    !Number.isFinite(tenureMonths) ||
    tenureMonths <= 0 ||
    principal <= 0
  ) {
    return null
  }

  const dp = Number.isFinite(downPayment) ? Math.max(0, downPayment) : 0

  // Interest, total and EMI are computed on the GROSS principal (matching the
  // backend) — the down payment does not enter these.
  const monthlyInterest = round2((principal * (annualRatePct / 100)) / 12)
  const totalInterest = round2(monthlyInterest * tenureMonths)
  const totalPayable = round2(principal + monthlyInterest * tenureMonths)
  const emi = round2(totalPayable / tenureMonths)

  // Informational only — the financed amount after the down payment. Mirrors the
  // backend's net_loan_principal; not part of the interest/EMI calculation.
  const netPrincipal = Math.max(0, principal - dp)

  return {
    netPrincipal,
    totalInterest,
    totalPayable,
    emi,
    monthlyInterest,
  }
}
