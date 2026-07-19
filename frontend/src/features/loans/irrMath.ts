// True-rate (IRR) maths for flat-rate loans — the companion to financeMath.ts.
//
// Why this exists: the business quotes a FLAT rate (interest charged on the
// full original principal for the whole tenure), but the customer repays
// principal every month and so only holds the full principal in month 1.
// The rate measured against the balance they actually owe — the IRR — comes out
// roughly DOUBLE the flat rate (median 1.75x across the current book).
//
//   60,000 @ 21% flat x 12mo -> EMI 6,050 -> true rate 36.74%
//   ...because the average outstanding over the life is only ~29,293 (49% of
//   the 60,000 the interest is charged on). Same interest, half the money.
//
// This module is DERIVED, DISPLAY-ONLY maths. It reads figures that already
// exist and persists nothing; it does not feed the EMI, the schedule, the
// penalties, or anything the customer is billed. financeMath.ts / the backend's
// services/finance.py remain the sole authority on what is owed.
//
// Ported from the owner's `IRR CAL SHEET.xls` (sheets `Value` + `CashFlow`),
// whose flat-rate formulas are arithmetically identical to ours. Spec and
// derivation: docs/IRR_FEATURE_HANDOFF.md in the sriadithyafinancedocs repo.

export interface AmortRow {
  /** 1-based instalment number. */
  n: number
  /** Interest portion of this EMI (balance x monthlyRate). */
  interest: number
  /** Principal portion of this EMI (emi - interest). */
  principal: number
  /** Outstanding principal AFTER this EMI. */
  balance: number
}

export interface LoanTerms {
  principal: number
  /** The regular EMI — every instalment except the last. */
  emi: number
  tenureMonths: number
  /**
   * The final instalment, which absorbs the rounding remainder and so differs
   * from `emi` by a few paise. Defaults to `emi` when not known. Pass the real
   * value wherever it is available — see the note on accuracy below.
   */
  finalEmi?: number
}

// The IRR is solved over the ACTUAL cashflow, so the final stub instalment
// matters. The backend (services/finance.py `emi_schedule`) defines it as:
//     final = total_payable - regular_emi * (tenure - 1)
// For a saved loan, prefer the real per-cycle amounts from due_cycles. For the
// wizard's pre-save estimate no cycles exist yet, so we reconstruct the stub
// from the projection instead. The two can differ by a hair; that is expected,
// not a defect, and is why the wizard labels its figures "indicative".
export function loanCashflow({ principal, emi, tenureMonths, finalEmi }: LoanTerms): number[] {
  const last = finalEmi ?? emi
  const flows = [-principal]
  for (let i = 1; i < tenureMonths; i++) flows.push(emi)
  if (tenureMonths >= 1) flows.push(last)
  return flows
}

// Net present value of `cashflow` at monthly rate `rate`. cashflow[0] is the
// disbursement (negative); the rest are instalments received.
function npv(rate: number, cashflow: number[]): number {
  let acc = 0
  for (let i = 0; i < cashflow.length; i++) acc += cashflow[i] / (1 + rate) ** i
  return acc
}

const LOWER = 1e-9
const UPPER = 2.0 // 200%/month — far beyond any real deal; brackets the root.
const ITERATIONS = 200

/**
 * The monthly IRR of a cashflow, by bisection.
 *
 * Returns null rather than throwing when there is no root to find — a 0%-interest
 * loan (instalments sum to exactly the principal), a degenerate cashflow, or
 * anything outside the bracket. Callers should hide the IRR entirely in that
 * case rather than render 0 or NaN.
 *
 * Bisection (not Newton) because it cannot diverge and the bracket is known:
 * NPV is strictly decreasing in `rate` for a conventional loan cashflow (one
 * sign change), so the root is unique and 200 halvings pin it to well beyond
 * double precision.
 */
export function monthlyIrr(cashflow: number[]): number | null {
  if (cashflow.length < 2) return null
  if (!cashflow.every((c) => Number.isFinite(c))) return null

  // No root in the bracket: NPV never crosses zero. Covers the 0%-interest case
  // (npv(LOWER) is ~0 but not positive) and any inverted/degenerate flow.
  if (npv(LOWER, cashflow) <= 0) return null
  if (npv(UPPER, cashflow) >= 0) return null

  let lo = LOWER
  let hi = UPPER
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (npv(mid, cashflow) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * The annual IRR as a percentage — the headline "true rate".
 *
 * Annualised SIMPLY (monthly x 12), not compounded. This reproduces the source
 * spreadsheet exactly and matches standard NBFC/APR convention; compounding
 * ((1+m)^12 - 1) would read materially higher (36.74% -> 43.9% on the example
 * above) and would not tie back to anything the business already quotes.
 * Do not "fix" this to compounding without a deliberate decision.
 */
export function annualIrrPct(cashflow: number[]): number | null {
  const m = monthlyIrr(cashflow)
  return m === null ? null : m * 12 * 100
}

/**
 * The reducing-balance amortisation schedule: how each EMI splits into interest
 * and principal once the true rate is applied.
 *
 * This is the schedule the IRR implies — it explains where the money goes, and
 * drives both the amortisation table and the balance curve behind the chart.
 * It is NOT the billing schedule: the customer is billed a flat EMI from
 * due_cycles regardless of this split.
 *
 * Returns [] when the terms are unusable or the IRR cannot be solved.
 */
export function amortSchedule(terms: LoanTerms): AmortRow[] {
  const { principal, emi, tenureMonths, finalEmi } = terms
  if (!Number.isFinite(principal) || !Number.isFinite(emi)) return []
  if (principal <= 0 || emi <= 0 || tenureMonths <= 0) return []

  const rate = monthlyIrr(loanCashflow(terms))
  if (rate === null) return []

  const rows: AmortRow[] = []
  let balance = principal
  for (let n = 1; n <= tenureMonths; n++) {
    const due = n === tenureMonths ? (finalEmi ?? emi) : emi
    const interest = balance * rate
    const principalPart = due - interest
    balance -= principalPart
    rows.push({
      n,
      interest,
      principal: principalPart,
      // The last row lands on ~0 but for floating-point dust; clamp so the
      // table and the chart both end cleanly at zero.
      balance: n === tenureMonths ? 0 : Math.max(0, balance),
    })
  }
  return rows
}

/**
 * The average outstanding balance over the life of the loan.
 *
 * This is the number that makes the whole feature make sense: interest is
 * charged on `principal`, but the customer only owes this much on average, so
 * the true rate is (principal / avgOutstanding) x the flat rate. For the
 * example above that ratio is 60,000 / 29,293 = 2.05x.
 *
 * Returns null when there is no schedule to average.
 */
export function avgOutstanding(rows: AmortRow[]): number | null {
  if (rows.length === 0) return null
  const total = rows.reduce((acc, r) => acc + r.balance, 0)
  return total / rows.length
}
