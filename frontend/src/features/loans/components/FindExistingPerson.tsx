import { useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import {
  usePersonnelLookup,
  useAddPersonnelToLoan,
  type LoanAssociationSummary,
} from '@/api/queries/personnel'
import { Btn, ErrorBanner, Input } from '@/components/primitives'
import { MOBILE_RE } from '@/schemas/primitives'
import type { PersonnelRole } from '@/schemas/enums'

function mapErr(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (error.response?.status === 409) return detail ?? 'This person is already linked to this finance.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return fallback
}

const ROLE_LABEL: Record<PersonnelRole, string> = {
  GUARANTOR: 'guarantor',
  CO_HIRER: 'co-hirer',
}

// Look up an existing person by mobile and link them to this finance, instead
// of re-creating (a recurring guarantor's mobile is unique → create would 409).
// `loanId` is the loan/finance id; in the wizard that is the draft financeId.
export function FindExistingPerson({
  loanId,
  role,
  onLinked,
  onCancel,
}: {
  loanId: string
  role: PersonnelRole
  onLinked: () => void
  onCancel: () => void
}) {
  const lookup = usePersonnelLookup()
  const link = useAddPersonnelToLoan(loanId)
  const [mobile, setMobile] = useState('')
  const [mobileError, setMobileError] = useState<string | null>(null)
  const [relationship, setRelationship] = useState('')

  const result = lookup.data
  const person = result?.found ? result.personnel : null
  const associations = result?.existing_loan_associations ?? []
  const alreadyOnThisLoan = associations.some((a) => a.loan_id === loanId)

  const search = () => {
    const m = mobile.trim()
    if (!MOBILE_RE.test(m)) {
      setMobileError('Enter a 10-digit mobile starting 6/7/8/9')
      return
    }
    setMobileError(null)
    link.reset()
    lookup.mutate({ mobile_number: m })
  }

  const useThisPerson = () => {
    if (!person) return
    link.mutate(
      { personnel_id: person.id, role, relationship_to_hirer: relationship.trim() || null },
      { onSuccess: onLinked },
    )
  }

  return (
    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Search by mobile number to re-use a person already on file.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-end' } }}>
          <Box sx={{ flex: 1 }}>
            <Input
              id="find_pn_mobile"
              label="Mobile number"
              inputMode="numeric"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
              error={mobileError ?? undefined}
            />
          </Box>
          <Btn type="button" variant="primary" onClick={search} loading={lookup.isPending}>
            Search
          </Btn>
        </Stack>

        {lookup.isError && (
          <ErrorBanner message={mapErr(lookup.error, 'Could not search. Please try again.')} />
        )}

        {result && !result.found && (
          <ErrorBanner
            severity="info"
            variant="outlined"
            message="No person on file with this mobile. Use “Add new” to create one."
          />
        )}

        {person && (
          <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-sm)' }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {person.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
              {person.mobile_number}
            </Typography>

            {associations.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Already attached to {associations.length}{' '}
                  {associations.length === 1 ? 'finance' : 'finances'}:
                </Typography>
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {associations.map((a: LoanAssociationSummary) => (
                    <Typography key={a.loan_personnel_id} variant="body2" color="text.secondary">
                      • {a.loan_number} — {a.customer_name} ({ROLE_LABEL[a.role]})
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}

            {alreadyOnThisLoan ? (
              <Box sx={{ mt: 1.5 }}>
                <ErrorBanner
                  severity="warning"
                  variant="outlined"
                  message="This person is already linked to this finance."
                />
              </Box>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                <Input
                  id="find_pn_rel"
                  label="Relationship to hirer"
                  placeholder="Optional, e.g. Brother"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />
                {link.isError && (
                  <ErrorBanner message={mapErr(link.error, 'Could not link this person.')} />
                )}
                <Box>
                  <Btn type="button" variant="primary" onClick={useThisPerson} loading={link.isPending}>
                    Link this {ROLE_LABEL[role]}
                  </Btn>
                </Box>
              </Stack>
            )}
          </Box>
        )}

        <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
          <Btn type="button" variant="ghost" onClick={onCancel} disabled={link.isPending}>
            Cancel
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}
