// The customer-facing loan identifier. We show the HP number (hire-purchase
// number, carried over from the legacy iFinanceBooks system) everywhere in the
// UI. The internal loan_number (LMS-…) stays in the background — it's still the
// system id and a fallback for older/draft rows that don't have an HP number
// yet (HP No is entered in the wizard's financial step and required to approve).
//
// Accepts any shape carrying both fields (LoanResponse and the various nested
// worklist/association items all qualify).
export function loanDisplayId(loan: {
  hp_number?: string | null
  loan_number: string
}): string {
  return loan.hp_number?.trim() || loan.loan_number
}
