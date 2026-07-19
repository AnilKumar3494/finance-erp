import { flatRateProjection } from '../financeMath'
import {
  amortSchedule,
  annualIrrPct,
  avgOutstanding,
  loanCashflow,
  type AmortRow,
} from '../irrMath'

// The single source of numbers behind the three rendered sheets (Input / Amort /
// DV). Both callers — the wizard (live form values) and the saved-loan card
// (real cycles) — build one of these and hand it to the sheet components, so the
// three tabs always agree with each other and with the on-screen figures.
//
// The arithmetic is the workbook's own: Interest = FlatRate × Tenure × Principal
// / 12, EMI = (Principal + Interest) / n, Deal IRR = monthly IRR × 12. See
// docs/IRR_FEATURE_HANDOFF.md.

export interface IrrSheetContext {
  /** Vehicle cost — the sheet's "Asset Cost" / DV "Invoice Amt". Often unknown. */
  assetCost?: number | null
  customerName?: string | null
  /** Village/mandal — the Amort sheet's "Location". */
  location?: string | null
  /** HP number — the Amort sheet's "Agreement no." */
  agreementNo?: string | null
  /** First EMI due date (ISO) — drives the Amort schedule's repay dates. */
  startDate?: string | null
  /** Processing + documentation + any other fees — DV "Service Charges". */
  fees?: number
}

export interface IrrSheetModel {
  // Inputs echoed for the sheet
  assetCost: number | null
  netFinance: number
  flatRatePct: number
  tenureMonths: number
  numInstalments: number
  fees: number
  // Derived
  monthlyInterest: number
  totalInterest: number
  agreementValue: number
  emi: number
  finalEmi: number
  disbursement: number
  dealIrrPct: number | null
  exposurePct: number | null
  avgOutstanding: number | null
  schedule: AmortRow[]
  // Context passthrough
  customerName: string | null
  location: string | null
  agreementNo: string | null
  startDate: string | null
}

export interface IrrSheetInput extends IrrSheetContext {
  principal: number
  flatRatePct: number
  tenureMonths: number
  /**
   * The regular EMI. Pass the loan's real base EMI where known (saved loans);
   * omit to derive it from the flat-rate projection (the wizard, pre-save).
   */
  emi?: number
  finalEmi?: number
}

/** Returns null when the inputs can't form a valid loan (so callers render nothing). */
export function buildIrrSheetModel(input: IrrSheetInput): IrrSheetModel | null {
  const { principal, flatRatePct, tenureMonths } = input
  if (!Number.isFinite(principal) || !Number.isFinite(flatRatePct)) return null
  if (!Number.isFinite(tenureMonths) || principal <= 0 || tenureMonths <= 0) return null

  const proj = flatRateProjection({
    principal,
    annualRatePct: flatRatePct,
    tenureMonths,
  })
  if (!proj) return null

  const emi = input.emi ?? proj.emi
  const finalEmi = input.finalEmi ?? proj.totalPayable - emi * (tenureMonths - 1)

  // Total and interest follow whatever EMI actually applies, so the sheet ties
  // out to the schedule shown beside it.
  const agreementValue = emi * (tenureMonths - 1) + finalEmi
  const totalInterest = agreementValue - principal
  const monthlyInterest = proj.monthlyInterest

  const terms = { principal, emi, tenureMonths, finalEmi }
  const schedule = amortSchedule(terms)
  const dealIrrPct = annualIrrPct(loanCashflow(terms))
  const avg = avgOutstanding(schedule)

  const fees = Number.isFinite(input.fees) ? (input.fees as number) : 0
  const assetCost =
    input.assetCost != null && Number.isFinite(input.assetCost) ? input.assetCost : null
  const exposurePct = assetCost && assetCost > 0 ? (principal / assetCost) * 100 : null

  return {
    assetCost,
    netFinance: principal,
    flatRatePct,
    tenureMonths,
    numInstalments: tenureMonths,
    fees,
    monthlyInterest,
    totalInterest,
    agreementValue,
    emi,
    finalEmi,
    disbursement: Math.max(0, principal - fees),
    dealIrrPct,
    exposurePct,
    avgOutstanding: avg,
    schedule,
    customerName: input.customerName ?? null,
    location: input.location ?? null,
    agreementNo: input.agreementNo ?? null,
    startDate: input.startDate ?? null,
  }
}
