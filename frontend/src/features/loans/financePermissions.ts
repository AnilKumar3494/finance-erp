import type { LoanResponse } from '@/api/queries/loans'
import { useAuth } from '@/app/auth-context'
import { LOAN_STATUS_META } from './loanStatusMeta'

// Per-section edit permission. `warning` is set only when an admin is editing
// outside the normal DRAFT/ACTIVE window — the UI surfaces it as an override
// banner; the action itself is still allowed and audited server-side.
export interface SectionPermission {
  canEdit: boolean
  warning?: string
}

export interface FinancePermissions {
  isAdmin: boolean
  isAssignedEmployee: boolean
  editableStatus: boolean
  // Admin / Super-Admin only.
  finance: SectionPermission
  // Assigned employee or admin.
  vehicle: SectionPermission
  customer: SectionPermission
  personnel: SectionPermission
  documents: SectionPermission
}

// Two-tier gate:
//  - Admin / Super-Admin: may edit every section. On a terminal/non-editable
//    status they may still edit, but with an override warning.
//  - Assigned employee: may edit Customer / Personnel / Documents while the
//    finance is DRAFT or ACTIVE.
export function useFinancePermissions(loan: LoanResponse): FinancePermissions {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const isAssignedEmployee =
    !!user && user.id === (loan.customer?.assigned_employee_id ?? null)
  const editableStatus = loan.status === 'DRAFT' || loan.status === 'ACTIVE'

  const overrideWarning = `This finance is ${LOAN_STATUS_META[loan.status].label}. Editing here is an administrative override and is recorded in the audit trail.`

  // Loan terms: admins only.
  const adminSection = (): SectionPermission => {
    if (isAdmin && editableStatus) return { canEdit: true }
    if (isAdmin) return { canEdit: true, warning: overrideWarning }
    return { canEdit: false }
  }

  // Vehicle + Customer + Personnel + Documents: assigned employee or admin.
  const sharedSection = (): SectionPermission => {
    if ((isAssignedEmployee || isAdmin) && editableStatus) return { canEdit: true }
    if (isAdmin) return { canEdit: true, warning: overrideWarning }
    return { canEdit: false }
  }

  return {
    isAdmin,
    isAssignedEmployee,
    editableStatus,
    finance: adminSection(),
    vehicle: sharedSection(),
    customer: sharedSection(),
    personnel: sharedSection(),
    documents: sharedSection(),
  }
}
