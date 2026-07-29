import { useMemo } from 'react'

import { useCustomer } from '@/api/queries/customers'
import { useDocuments } from '@/api/queries/documents'
import { useCustomerIdentityProofs } from '@/api/queries/identityProofs'
import type { LoanResponse } from '@/api/queries/loans'
import { useLoanPersonnel } from '@/api/queries/personnel'
import { useStabilityDocs } from '@/api/queries/stabilityDocs'
import { computeDocCompleteness, type DocCompleteness } from './docCompleteness'

export interface DocCompletenessState {
  isLoading: boolean
  isError: boolean
  data: DocCompleteness | null
}

// Gathers everything the score needs and computes it.
//
// `data` stays null until EVERY input has resolved. Scoring partial data would
// render a confidently wrong low number that climbs as requests land — which
// looks exactly like a real score, so callers would have no way to tell it apart
// from a genuinely thin file. The gate lives here rather than in callers so a
// new surface can't reintroduce the flash.
//
// Four of the five queries dedupe against the loan detail page's existing
// section queries (customer, identity proofs, personnel, vehicle documents).
// Stability docs are a genuinely new request there — they are only fetched in
// the wizard today.
//
// Do NOT call this per row in a list. See the note in docCompleteness.ts.
export function useDocCompleteness(loan: LoanResponse): DocCompletenessState {
  const hasVehicle = Boolean(loan.vehicle_id)

  const customer = useCustomer(loan.customer_id)
  const proofs = useCustomerIdentityProofs(loan.customer_id)
  const stability = useStabilityDocs(loan.id)
  const personnel = useLoanPersonnel(loan.id)
  // Params must match VehicleInfoSection's call EXACTLY — `{ vehicle_id,
  // page_size: 100 }`, no doc_type — or the query key diverges and this refetches
  // instead of hitting the warm cache. PhotosSection passes doc_type and is a
  // different key on purpose; don't copy that one.
  //
  // `?? ''` rather than undefined: TanStack's key hash drops undefined values, so
  // `{ vehicle_id: undefined, page_size: 100 }` would collide with the unscoped
  // document list. Harmless while disabled, but a trap worth closing.
  const vehicleDocs = useDocuments(
    { vehicle_id: loan.vehicle_id ?? '', page_size: 100 },
    hasVehicle,
  )

  const vehicleReady = !hasVehicle || vehicleDocs.isSuccess
  const ready =
    customer.isSuccess &&
    proofs.isSuccess &&
    stability.isSuccess &&
    personnel.isSuccess &&
    vehicleReady

  const isError =
    customer.isError ||
    proofs.isError ||
    stability.isError ||
    personnel.isError ||
    (hasVehicle && vehicleDocs.isError)

  // Computed unconditionally over possibly-empty arrays so hook order stays
  // stable; the result is withheld at the return until `ready`.
  const data = useMemo(
    () =>
      computeDocCompleteness({
        customer: customer.data ?? null,
        identityProofs: proofs.data?.results ?? [],
        stabilityDocs: stability.data?.results ?? [],
        vehicleDocs: vehicleDocs.data?.results ?? [],
        hasVehicle,
        personnel: personnel.data?.results ?? [],
      }),
    [customer.data, proofs.data, stability.data, vehicleDocs.data, personnel.data, hasVehicle],
  )

  return {
    isLoading: !ready && !isError,
    isError,
    data: ready ? data : null,
  }
}
