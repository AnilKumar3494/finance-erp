import { createContext, useContext, useEffect, useRef } from 'react'

// Lets each wizard step's form report whether it currently holds unsaved
// edits. The wizard (FinanceWizardPage) aggregates these and warns before
// navigating away from a step while any mounted form is dirty.
export interface WizardGuardApi {
  register: (id: symbol, dirty: boolean) => void
  unregister: (id: symbol) => void
}

export const WizardGuardContext = createContext<WizardGuardApi | null>(null)

// Call from a form with its RHF `formState.isDirty` (or a derived flag).
export function useReportDirty(dirty: boolean): void {
  const api = useContext(WizardGuardContext)
  const idRef = useRef<symbol | null>(null)
  if (idRef.current === null) idRef.current = Symbol('wizard-form')
  const id = idRef.current

  useEffect(() => {
    api?.register(id, dirty)
  }, [api, id, dirty])

  // Drop this form's contribution when it unmounts — step change, or the form
  // collapsing after a successful save.
  useEffect(() => () => api?.unregister(id), [api, id])
}
