// Flat-rate finance projection — mirrors the backend's flat-interest scheme so
// the wizard can show indicative figures (EMI, total interest) as the employee
// types, before the loan is saved/approved. This is informational only: the
// authoritative numbers come from the backend (total_payable, monthly_interest,
// per-cycle base_emi) and are used wherever they're available.
//
// Scheme (flat rate on the financed principal):
//   net principal   = principal − down payment
//   total interest  = net principal × (annual rate% / 100) × (tenure / 12)
//   total payable   = net principal + total interest
//   EMI             = total payable / tenure
// Fees (processing/documentation) are deducted from the disbursed amount and do
// not change the EMI, so they're excluded here.

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

// Returns null unless principal, rate, and tenure are all present and valid
// (positive tenure), so callers can simply skip rendering when inputs are
// incomplete.
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
  const netPrincipal = Math.max(0, principal - dp)
  const totalInterest = netPrincipal * (annualRatePct / 100) * (tenureMonths / 12)
  const totalPayable = netPrincipal + totalInterest

  return {
    netPrincipal,
    totalInterest,
    totalPayable,
    emi: totalPayable / tenureMonths,
    monthlyInterest: totalInterest / tenureMonths,
  }
}
