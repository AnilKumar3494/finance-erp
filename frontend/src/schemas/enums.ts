import { z } from 'zod'

// Mirrors backend enums in app/models/*.py
// Keep in sync manually; codegen handles response types.

export const UserRole = z.enum(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'])
export type UserRole = z.infer<typeof UserRole>

export const LoanStatus = z.enum([
  'DRAFT',
  'ACTIVE',
  'AWAITING_CLOSURE',
  'CLOSED',
  'BAD_DEBT_PROPOSED',
  'BAD_DEBT',
])
export type LoanStatus = z.infer<typeof LoanStatus>

export const PaymentMethod = z.enum(['CASH', 'GPAY', 'PHONEPE', 'BANK_TRANSFER'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const TransactionStatus = z.enum(['PENDING', 'SUCCESS', 'FAILED'])
export type TransactionStatus = z.infer<typeof TransactionStatus>

export const TransactionType = z.enum(['REGULAR', 'DOWN_PAYMENT'])
export type TransactionType = z.infer<typeof TransactionType>

export const PunctualityStatus = z.enum(['AWAITING_REVIEW', 'PAID_ON_TIME', 'LATE_PAYMENT'])
export type PunctualityStatus = z.infer<typeof PunctualityStatus>

export const AssetType = z.enum(['INVENTORY', 'COLLATERAL'])
export type AssetType = z.infer<typeof AssetType>

export const AssetStatus = z.enum(['IN_YARD', 'SEIZED', 'MAINTENANCE', 'SOLD'])
export type AssetStatus = z.infer<typeof AssetStatus>

export const CycleStatus = z.enum([
  'UPCOMING',
  'AWAITING_REVIEW',
  'PAID_ON_TIME',
  'LATE_PAYMENT',
  'MISSED_CAPPED',
])
export type CycleStatus = z.infer<typeof CycleStatus>

export const PersonnelRole = z.enum(['GUARANTOR', 'CO_HIRER'])
export type PersonnelRole = z.infer<typeof PersonnelRole>

export const IdentityProofType = z.enum([
  'AADHAAR',
  'PAN',
  'DRIVING_LICENSE',
  'RATION_CARD',
  'VOTER_ID',
  'MGNREGA_CARD',
  'OTHER',
])
export type IdentityProofType = z.infer<typeof IdentityProofType>

export const StabilityDocType = z.enum([
  'PROPERTY_TAX',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'CHEQUE_PDC',
  'OTHER',
])
export type StabilityDocType = z.infer<typeof StabilityDocType>

export const DocCategory = z.enum([
  'ARCHIVE',
  'KYC',
  'LOAN_AGREEMENT',
  'RECEIPT',
  'VEHICLE_IMAGE',
  'IDENTITY_PROOF',
  'STABILITY_DOC',
  'RC_COPY',
  'INSURANCE_POLICY',
  'VEHICLE_PHOTO',
])
export type DocCategory = z.infer<typeof DocCategory>

export const BadDebtProposalStatus = z.enum(['PROPOSED', 'APPROVED', 'REJECTED'])
export type BadDebtProposalStatus = z.infer<typeof BadDebtProposalStatus>

export const ClosureType = z.enum([
  'NORMAL_TENURE',
  'EARLY_FORECLOSURE',
  'NEGOTIATED_SETTLEMENT',
  'WRITE_OFF',
])
export type ClosureType = z.infer<typeof ClosureType>
