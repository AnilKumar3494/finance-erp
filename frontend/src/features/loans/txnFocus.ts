import { useEffect, useRef } from 'react'

// Cross-component signal: "scroll to and briefly highlight this transaction
// row." Used by the cycle status chip (in DueCyclesTab) so clicking a
// "Pending confirmation" chip jumps the user straight to the relevant
// transaction in TransactionsTab where they can Confirm or Fail it.
//
// Two-component-graph problem: DueCyclesTab and TransactionsTab don't share a
// parent that's close enough to thread a prop, and they sometimes render in
// different layouts (the cockpit page vs. the loan-detail page with
// CollapsibleCards). A module-level subject keeps the wiring trivial — every
// listener sees every emit. The CollapsibleCard wrapper in LoanSubResources
// also listens so the Transactions card auto-expands when targeted.

type Listener = (txnId: string) => void

const listeners = new Set<Listener>()

export function focusTransaction(txnId: string): void {
  for (const fn of listeners) fn(txnId)
}

// useTransactionFocus subscribes to focus events for the lifetime of the
// component. The handler is held in a ref so consumers don't need to memoise
// it — a fresh closure every render is fine.
export function useTransactionFocus(handler: (txnId: string) => void): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  }, [handler])

  useEffect(() => {
    const fn: Listener = (txnId) => ref.current(txnId)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
}
