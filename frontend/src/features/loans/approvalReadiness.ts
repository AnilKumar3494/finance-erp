import type { LoanResponse } from '@/api/queries/loans'
import type { CustomerResponse } from '@/api/queries/customers'

// Sections that gate approval. Keys map to the detail-page EditableSection
// `sectionId`s so the approval checklist can jump straight to the right editor.
export type ApprovalSectionKey = 'vehicle' | 'finance' | 'customer'

// `field` is a stable key the section editors use to highlight the matching
// input; `label` is the human-readable name shown in the checklist / banner.
export interface ApprovalMissingField {
  field: string
  label: string
}

export interface ApprovalGap {
  key: ApprovalSectionKey
  title: string
  missing: ApprovalMissingField[]
}

// Fields a DRAFT must have before an admin can approve it. Mirrors the wizard's
// required set, trimmed to what approval actually needs (Aadhaar OR PAN, not
// both; DOB is not required here). `customer` is null while it loads — callers
// must wait for it before treating the result as authoritative.
export function computeApprovalGaps(
  loan: LoanResponse,
  customer: CustomerResponse | null,
): ApprovalGap[] {
  const gaps: ApprovalGap[] = []

  const vehicle: ApprovalMissingField[] = []
  if (!loan.vehicle_id || !loan.vehicle) {
    vehicle.push({ field: 'vehicle', label: 'Attach a collateral vehicle' })
  } else {
    if (!loan.vehicle.plate_number) vehicle.push({ field: 'plate_number', label: 'Registration number' })
    if (!loan.vehicle.make) vehicle.push({ field: 'make', label: 'Make' })
    if (!loan.vehicle.model) vehicle.push({ field: 'model', label: 'Model' })
    if (loan.vehicle.year == null) vehicle.push({ field: 'year', label: 'Year' })
  }
  if (vehicle.length) gaps.push({ key: 'vehicle', title: 'Vehicle Information', missing: vehicle })

  const finance: ApprovalMissingField[] = []
  if (loan.principal == null) finance.push({ field: 'principal', label: 'Principal' })
  if (loan.interest_rate == null) finance.push({ field: 'interest_rate', label: 'Interest rate' })
  if (loan.tenure == null) finance.push({ field: 'tenure', label: 'Tenure' })
  if (finance.length) gaps.push({ key: 'finance', title: 'Finance terms', missing: finance })

  if (customer) {
    const cust: ApprovalMissingField[] = []
    if (!customer.full_name) cust.push({ field: 'full_name', label: 'Full name' })
    if (!customer.mobile_number) cust.push({ field: 'mobile_number', label: 'Mobile number' })
    if (!customer.address_line_1) cust.push({ field: 'address_line_1', label: 'Address line 1' })
    if (!customer.mandal_village) cust.push({ field: 'mandal_village', label: 'Mandal / village' })
    if (!customer.pincode) cust.push({ field: 'pincode', label: 'PIN code' })
    if (customer.aadhaar_number == null && customer.pan_number == null) {
      cust.push({ field: 'identity', label: 'Aadhaar or PAN (at least one)' })
    }
    if (cust.length) gaps.push({ key: 'customer', title: 'Customer details', missing: cust })
  }

  return gaps
}
