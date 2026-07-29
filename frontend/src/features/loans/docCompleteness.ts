import type { CustomerResponse } from '@/api/queries/customers'
import type { DocumentResponse } from '@/api/queries/documents'
import type { IdentityProofResponse } from '@/api/queries/identityProofs'
import type { LoanPersonnelResponse } from '@/api/queries/personnel'
import type { StabilityDocumentResponse } from '@/api/queries/stabilityDocs'

// Documentation completeness — how much paperwork is on file for a finance,
// scored out of 100 to help an admin judge a DRAFT at a glance.
//
// ADVISORY ONLY. This never gates approval; that stays with computeApprovalGaps
// in approvalReadiness.ts, which is a separate and deliberately independent set
// of rules.
//
// It counts documents; it does NOT verify them. Nothing in the schema records
// whether a document is genuine, legible, current or virus-scanned — there is no
// verified flag, no expiry date and no scan status anywhere — so presence is the
// only signal available. Every surface repeats that caveat, because a number out
// of 100 otherwise gets read as a creditworthiness score.
//
// PERFORMANCE: never reuse useDocCompleteness for a list column. It fires five
// queries per loan; twenty rows would be ~80 requests. A list score needs a
// backend aggregate, not this.

// --------------------------------------------------
// Weights — every number here is client policy, not a fact about the domain.
// Kept in one block so a revision is a one-line diff rather than a code hunt.
// --------------------------------------------------
export const DOC_SCORE_WEIGHTS = {
  aadhaar: { number: 6, file: 9 }, // 15
  pan: { number: 5, file: 7 }, // 12
  other: { number: 5, file: 8 }, // 13
  // Indexed by count of distinct qualifying subtypes, capped at the last entry.
  stabilityByCount: [0, 12, 16, 20],
  rcCopy: 12,
  insurance: 10,
  photosByCount: [0, 4, 6, 8],
  guarantor: { aadhaar: 6, pan: 4 }, // 10
} as const

const CATEGORY_MAX = {
  customer_id: 40,
  stability: 20,
  vehicle: 30,
  guarantor: 10,
} as const

// Stability subtypes that count toward the score. OTHER is excluded on purpose:
// it is a free-text catch-all, so counting it would let any uploaded file claim
// the points. Revisit with the client if they file real proofs under Other.
const QUALIFYING_STABILITY = ['PROPERTY_TAX', 'ELECTRICITY_BILL', 'BANK_STATEMENT', 'CHEQUE_PDC']

export type DocScoreCategoryKey = keyof typeof CATEGORY_MAX

export interface DocScoreItem {
  key: string
  label: string
  points: number
  max: number
}

export interface DocScoreCategory {
  key: DocScoreCategoryKey
  title: string
  points: number
  // Never rescaled. A loan with no vehicle keeps a denominator of 30 and scores
  // 0 there — rescaling would show the least complete file in the system as
  // 100/100, and would make two loans both showing "80" mean different things.
  max: number
  items: DocScoreItem[]
  note?: string
}

export interface DocCompleteness {
  score: number
  categories: DocScoreCategory[]
  // Everything short of full marks, biggest shortfall first.
  missing: DocScoreItem[]
}

export interface DocCompletenessInput {
  customer: CustomerResponse | null
  identityProofs: IdentityProofResponse[]
  stabilityDocs: StabilityDocumentResponse[]
  vehicleDocs: DocumentResponse[]
  hasVehicle: boolean
  personnel: LoanPersonnelResponse[]
}

const PROOF_TYPE_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  DRIVING_LICENSE: 'Driving Licence',
  RATION_CARD: 'Ration Card',
  VOTER_ID: 'Voter ID',
  MGNREGA_CARD: 'MGNREGA Card',
  OTHER: 'Other ID',
}

const STABILITY_LABELS: Record<string, string> = {
  PROPERTY_TAX: 'Property tax',
  ELECTRICITY_BILL: 'Electricity bill',
  BANK_STATEMENT: 'Bank statement',
  CHEQUE_PDC: 'Cheque (PDC)',
  OTHER: 'Other',
}

const alive = <T extends { is_deleted: boolean }>(rows: T[]): T[] =>
  rows.filter((r) => !r.is_deleted)

// Tier lookups clamp rather than index out of bounds.
const tier = (table: readonly number[], count: number): number =>
  table[Math.min(count, table.length - 1)] ?? 0

export function computeDocCompleteness(input: DocCompletenessInput): DocCompleteness {
  const proofs = alive(input.identityProofs)
  const stability = alive(input.stabilityDocs)
  const vehicleDocs = alive(input.vehicleDocs)
  const personnel = input.personnel.filter((p) => !p.personnel.is_deleted)

  const categories: DocScoreCategory[] = [
    scoreCustomerId(proofs, input.customer),
    scoreStability(stability),
    scoreVehicle(vehicleDocs, input.hasVehicle),
    scoreGuarantor(personnel),
  ]

  const score = Math.max(
    0,
    Math.min(100, Math.round(categories.reduce((sum, c) => sum + c.points, 0))),
  )

  const missing = categories
    .flatMap((c) => c.items)
    .filter((i) => i.points < i.max)
    .sort((a, b) => b.max - b.points - (a.max - a.points))

  return { score, categories, missing }
}

// --------------------------------------------------
// A — Customer identity proofs (40)
// --------------------------------------------------
function scoreCustomerId(
  proofs: IdentityProofResponse[],
  customer: CustomerResponse | null,
): DocScoreCategory {
  const byType = new Map(proofs.map((p) => [p.proof_type as string, p]))

  // The number sub-signal reads the customer record as well as the proof row.
  // A proof row can only be created by uploading a file (the create call lives
  // inside FileUpload's onUploaded), so id_number never exists on its own —
  // without this fallback the number points would be unreachable and a customer
  // whose Aadhaar was typed during KYC would score nothing for it.
  const aadhaarProof = byType.get('AADHAAR')
  const panProof = byType.get('PAN')

  const w = DOC_SCORE_WEIGHTS
  const aadhaarNumber = aadhaarProof?.id_number != null || customer?.aadhaar_number != null
  const panNumber = panProof?.id_number != null || customer?.pan_number != null

  const items: DocScoreItem[] = [
    {
      key: 'aadhaar_number',
      label: 'Aadhaar number recorded',
      points: aadhaarNumber ? w.aadhaar.number : 0,
      max: w.aadhaar.number,
    },
    {
      key: 'aadhaar_file',
      label: 'Aadhaar scan uploaded',
      points: aadhaarProof?.document_id != null ? w.aadhaar.file : 0,
      max: w.aadhaar.file,
    },
    {
      key: 'pan_number',
      label: 'PAN number recorded',
      points: panNumber ? w.pan.number : 0,
      max: w.pan.number,
    },
    {
      key: 'pan_file',
      label: 'PAN scan uploaded',
      points: panProof?.document_id != null ? w.pan.file : 0,
      max: w.pan.file,
    },
    scoreAlternateProof(proofs),
  ]

  return {
    key: 'customer_id',
    title: 'Customer ID Proofs',
    points: items.reduce((s, i) => s + i.points, 0),
    max: CATEGORY_MAX.customer_id,
    items,
  }
}

// Best single non-Aadhaar/PAN proof. Deliberately best-of rather than a sum:
// a second alternate ID adds no underwriting value, so stacking would let a
// file inflate its score by uploading the same kind of document twice.
function scoreAlternateProof(proofs: IdentityProofResponse[]): DocScoreItem {
  const w = DOC_SCORE_WEIGHTS.other
  const max = w.number + w.file
  let best = 0
  let bestType: string | null = null

  for (const p of proofs) {
    if (p.proof_type === 'AADHAAR' || p.proof_type === 'PAN') continue
    const points = (p.id_number != null ? w.number : 0) + (p.document_id != null ? w.file : 0)
    if (points > best) {
      best = points
      bestType = p.proof_type
    }
  }

  return {
    key: 'other_proof',
    label: bestType
      ? `${PROOF_TYPE_LABELS[bestType] ?? bestType} (additional proof)`
      : 'Any additional ID proof',
    points: best,
    max,
  }
}

// --------------------------------------------------
// B — Stability proof (20), tiered on distinct qualifying subtypes
// --------------------------------------------------
function scoreStability(docs: StabilityDocumentResponse[]): DocScoreCategory {
  const onFile = new Set<string>()

  for (const d of docs) {
    if (!QUALIFYING_STABILITY.includes(d.doc_subtype)) continue
    // A post-dated cheque is a physical instrument with a recorded count and
    // routinely no scan; without this carve-out a file whose only stability
    // proof is PDCs would score zero.
    const counts =
      d.document_id != null || (d.doc_subtype === 'CHEQUE_PDC' && (d.cheque_count ?? 0) >= 1)
    if (counts) onFile.add(d.doc_subtype)
  }

  const points = tier(DOC_SCORE_WEIGHTS.stabilityByCount, onFile.size)
  const labels = [...onFile].map((s) => STABILITY_LABELS[s] ?? s)

  return {
    key: 'stability',
    title: 'Stability Proof',
    points,
    max: CATEGORY_MAX.stability,
    items: [
      {
        key: 'stability',
        label:
          onFile.size === 0
            ? 'Stability proof (property tax, bill, bank statement or PDC)'
            : `Stability proof — ${labels.join(', ')}`,
        points,
        max: CATEGORY_MAX.stability,
      },
    ],
    note:
      onFile.size === 0
        ? undefined
        : `${onFile.size} of 3 counted${onFile.size < 3 ? ' — a further type adds points' : ''}`,
  }
}

// --------------------------------------------------
// C — Vehicle documents (30)
// --------------------------------------------------
function scoreVehicle(docs: DocumentResponse[], hasVehicle: boolean): DocScoreCategory {
  const w = DOC_SCORE_WEIGHTS
  const hasRc = docs.some((d) => d.doc_type === 'RC_COPY')
  const hasInsurance = docs.some((d) => d.doc_type === 'INSURANCE_POLICY')
  const photos = docs.filter((d) => d.doc_type === 'VEHICLE_PHOTO').length

  const items: DocScoreItem[] = [
    { key: 'rc_copy', label: 'RC copy', points: hasRc ? w.rcCopy : 0, max: w.rcCopy },
    {
      key: 'insurance',
      label: 'Insurance policy',
      points: hasInsurance ? w.insurance : 0,
      max: w.insurance,
    },
    {
      key: 'vehicle_photos',
      label: photos > 0 ? `Vehicle photos (${photos})` : 'Vehicle photos',
      points: tier(w.photosByCount, photos),
      max: w.photosByCount[w.photosByCount.length - 1],
    },
  ]

  return {
    key: 'vehicle',
    title: 'Vehicle Documents',
    points: items.reduce((s, i) => s + i.points, 0),
    max: CATEGORY_MAX.vehicle,
    items,
    note: hasVehicle ? undefined : 'No vehicle attached yet',
  }
}

// --------------------------------------------------
// D — Guarantor ID (10), on the recorded number
// --------------------------------------------------
function scoreGuarantor(personnel: LoanPersonnelResponse[]): DocScoreCategory {
  const w = DOC_SCORE_WEIGHTS.guarantor
  const max = w.aadhaar + w.pan
  // Guarantors only — a co-hirer is a second borrower, not a fallback payer.
  const guarantors = personnel.filter((p) => p.role === 'GUARANTOR')

  // Numbers arrive masked for non-admins ("********9012") but stay non-null, so
  // presence scores identically for every role. Never format-check them here.
  let best = 0
  for (const g of guarantors) {
    const points =
      (g.personnel.aadhaar_number != null ? w.aadhaar : 0) +
      (g.personnel.pan_number != null ? w.pan : 0)
    if (points > best) best = points
  }

  return {
    key: 'guarantor',
    title: 'Guarantor ID',
    points: best,
    max: CATEGORY_MAX.guarantor,
    items: [
      {
        key: 'guarantor_id',
        label:
          guarantors.length === 0
            ? 'Add a guarantor with an Aadhaar or PAN number'
            : "Guarantor's Aadhaar and PAN numbers",
        points: best,
        max,
      },
    ],
    note: guarantors.length === 0 ? 'No guarantor added yet' : undefined,
  }
}
