import type { LoanResponse } from '@/api/queries/loans'
import type { LoanTerms } from './irrMath'

// Turning a saved loan + its due cycles into the terms irrMath solves over.
// Kept out of the component file so both LoanIrrCard and LoanSubResources (which
// previews the rate on the collapsed card header) can share it.

/** Real per-cycle EMIs in cycle order. */
export function baseEmisOf(items: { cycle_number: number; base_emi: string }[]): number[] {
  return [...items].sort((a, b) => a.cycle_number - b.cycle_number).map((c) => Number(c.base_emi))
}

/**
 * The loan's actual terms, or null when they can't be established (a DRAFT with
 * no figures yet, or a loan with no cycles).
 *
 * Built from the real cycles rather than principal/emi/tenure because the IRR is
 * solved over the actual cashflow, and the last instalment carries the rounding
 * remainder (services/finance.py `emi_schedule`). The wizard has to estimate
 * that stub because no cycles exist pre-save, so the two figures can differ by a
 * hair — expected, not a defect.
 *
 * Uses `base_emi`, deliberately, not `total_due`: total_due carries penalties,
 * which are not part of the contract's rate.
 *
 * Note on down payments: the cashflow starts at the full principal, matching
 * financeMath's flat-rate scheme (the down payment is a prepayment against cycle
 * 1 and does not reduce the interest or the EMI). This is the contract's rate.
 * Nothing in the migrated book uses a down payment.
 */
export function loanIrrTerms(loan: LoanResponse, baseEmis: number[]): LoanTerms | null {
  const principal = Number(loan.principal ?? NaN)
  if (!Number.isFinite(principal) || principal <= 0) return null
  if (baseEmis.length === 0) return null
  if (!baseEmis.every((e) => Number.isFinite(e) && e > 0)) return null
  return {
    principal,
    emi: baseEmis[0],
    tenureMonths: baseEmis.length,
    finalEmi: baseEmis[baseEmis.length - 1],
  }
}
