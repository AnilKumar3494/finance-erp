import type { DueCycleResponse } from '@/api/queries/dueCycles'

// --------------------------------------------------
// Net due — a running-balance ("waterfall") view of what each cycle still
// owes, layered on top of the backend's static per-cycle schedule.
//
// The backend allocates each payment to ONE cycle and never moves a cycle's
// `total_due` in response to over/underpayment. So an overpayment on cycle 1
// leaves cycle 2's `total_due` unchanged even though the customer is, in
// reality, a month ahead. The spec (cases.md Case 5/6) wants the credit to
// roll forward. deriveNetDue reproduces that for display WITHOUT touching the
// authoritative figures the backend uses for classification and penalties.
//
// Algorithm: pour the loan's total paid (Σ SUCCESS) into the cycles in order.
// Each cycle absorbs up to its obligation; the leftover flows to the next.
//
//   pool        = totalPaid
//   obligation  = total_due           (normal cycle)
//   applied     = min(pool, obligation)
//   netDue      = obligation - applied
//   pool       -= applied
//
// Late-payment carry: when an admin classifies a cycle LATE_PAYMENT (or it
// hits MISSED_CAPPED), the backend spreads that cycle's (shortfall + penalty)
// into the LATER cycles' `total_due` as add-ons — but leaves the late cycle's
// own row untouched, so it keeps a shortfall forever. That deficit is now
// counted twice (once on the source row, once in the inflated future EMIs).
// To avoid double-counting AND to stop re-collecting money that's already
// being recovered, a late cycle that had later cycles to spread into uses its
// `total_received` as its obligation: it self-satisfies (netDue 0, resolved).
// The last-cycle-late case has no future cycles to spread into, so its
// shortfall is genuinely still owed — it stays a normal obligation.
//
// Invariant (holds in the normal payment flow): Σ netDue == loan outstanding.
// --------------------------------------------------

export interface CycleNetDue {
  // Effective amount still owed for this cycle after running credit forward.
  netDue: number
  // True when this is a late cycle whose deficit was rolled into later EMIs —
  // the row is a historical scar, not a live bill. UI should show "Recovered"
  // and not offer to collect against it.
  resolved: boolean
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function deriveNetDue(
  cycles: ReadonlyArray<DueCycleResponse>,
  totalPaid: number,
): Map<string, CycleNetDue> {
  const ordered = [...cycles].sort((a, b) => a.cycle_number - b.cycle_number)
  const lastNumber = ordered.length ? ordered[ordered.length - 1].cycle_number : 0

  let pool = Math.max(0, Number.isFinite(totalPaid) ? totalPaid : 0)
  const out = new Map<string, CycleNetDue>()

  for (const c of ordered) {
    const isLate =
      c.cycle_status === 'LATE_PAYMENT' || c.cycle_status === 'MISSED_CAPPED'
    // Spread only happened if there was a later cycle to spread into.
    const spreadForward = isLate && c.cycle_number < lastNumber

    const obligation = spreadForward
      ? Number(c.total_received)
      : Number(c.total_due)

    const applied = Math.min(pool, obligation)
    pool = round2(pool - applied)

    out.set(c.id, {
      netDue: spreadForward ? 0 : round2(obligation - applied),
      resolved: spreadForward,
    })
  }

  return out
}
