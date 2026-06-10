import type { DueCycleResponse } from '@/api/queries/dueCycles'
import type { TransactionResponse } from '@/api/queries/transactions'

// --------------------------------------------------
// Derived chip display for a due cycle.
//
// The backend cycle_status enum (UPCOMING / AWAITING_REVIEW / PAID_ON_TIME /
// LATE_PAYMENT / MISSED_CAPPED) reflects the official lifecycle: cycles are
// promoted by the nightly job and terminally classified by an admin. It does
// NOT, on its own, surface two situations the UI needs to flag:
//
//   1. Money is in flight: a PENDING transaction has been recorded against
//      the cycle but an admin hasn't confirmed (or failed) it yet. The raw
//      cycle_status is still UPCOMING / AWAITING_REVIEW so the chip would
//      read the same as a cycle with nothing happening — the collector has
//      no signal that the loop has closed.
//
//   2. Paid in advance: an UPCOMING cycle is fully covered by SUCCESS
//      transactions before its due_date. The cycle_status is still UPCOMING
//      (the nightly job promotes it to PAID_ON_TIME on the due date), so
//      without the override the chip would lie.
//
// deriveCycleDisplay collapses both signals into the chip's display state.
// Terminal classifications (PAID_ON_TIME / LATE_PAYMENT / MISSED_CAPPED) win
// over derived states — once an admin has classified a cycle, that's the
// truth, and a stray PENDING transaction shouldn't downgrade the chip.
// --------------------------------------------------

export type CycleDisplayKey =
  | 'UPCOMING'
  | 'PENDING_CONFIRMATION'
  | 'PAID_IN_ADVANCE'
  | 'AWAITING_REVIEW'
  | 'PAID_ON_TIME'
  | 'LATE_PAYMENT'
  | 'MISSED_CAPPED'

export interface CycleDisplay {
  key: CycleDisplayKey
  // ID of the PENDING transaction that drove the PENDING_CONFIRMATION state,
  // if any — used by the chip's onClick to jump to that row in
  // TransactionsTab. Undefined for every other state.
  pendingTxnId?: string
}

export function deriveCycleDisplay(
  cycle: Pick<DueCycleResponse, 'id' | 'cycle_status' | 'shortfall'>,
  txns: ReadonlyArray<
    Pick<TransactionResponse, 'id' | 'due_cycle_id' | 'status' | 'is_deleted'>
  >,
): CycleDisplay {
  // Terminal classifications stand. The admin's call is the truth.
  if (cycle.cycle_status === 'PAID_ON_TIME') return { key: 'PAID_ON_TIME' }
  if (cycle.cycle_status === 'LATE_PAYMENT') return { key: 'LATE_PAYMENT' }
  if (cycle.cycle_status === 'MISSED_CAPPED') return { key: 'MISSED_CAPPED' }

  const cycleTxns = txns.filter(
    (t) => !t.is_deleted && t.due_cycle_id === cycle.id,
  )

  // Money in flight wins over "Upcoming" / "Awaiting review" — it's the most
  // actionable state and lets the chip act as a Confirm shortcut.
  const pending = cycleTxns.find((t) => t.status === 'PENDING')
  if (pending) {
    return { key: 'PENDING_CONFIRMATION', pendingTxnId: pending.id }
  }

  const shortfall = Number(cycle.shortfall)
  const hasSuccess = cycleTxns.some((t) => t.status === 'SUCCESS')
  if (cycle.cycle_status === 'UPCOMING' && shortfall === 0 && hasSuccess) {
    return { key: 'PAID_IN_ADVANCE' }
  }

  if (cycle.cycle_status === 'AWAITING_REVIEW') return { key: 'AWAITING_REVIEW' }
  return { key: 'UPCOMING' }
}
