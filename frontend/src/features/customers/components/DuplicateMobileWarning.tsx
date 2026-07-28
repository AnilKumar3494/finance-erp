import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Link } from '@tanstack/react-router'

import { useCustomers } from '@/api/queries/customers'
import { ErrorBanner } from '@/components/primitives'
import { MOBILE_RE } from '@/schemas/primitives'

interface DuplicateMobileWarningProps {
  /** Current value of the mobile field, straight from the form. */
  mobile: string
  /** Customer being edited, so it does not warn about itself. Omit when creating. */
  excludeCustomerId?: string
}

/**
 * Advisory-only notice that a mobile number is already on file.
 *
 * As of migration 022 a number may back several active customers — households
 * share one handset — so this never blocks submission. It exists so staff
 * notice they may be re-onboarding someone who already exists, instead of
 * silently creating a duplicate record.
 */
export function DuplicateMobileWarning({ mobile, excludeCustomerId }: DuplicateMobileWarningProps) {
  const trimmed = mobile.trim()
  const isComplete = MOBILE_RE.test(trimmed)
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(isComplete ? trimmed : ''), 400)
    return () => clearTimeout(t)
  }, [trimmed, isComplete])

  // Only query once the number is a complete, valid mobile — a partial number
  // would match half the book and warn about strangers.
  const query = useCustomers({ page: 1, search: debounced, page_size: 10 }, debounced !== '')

  if (debounced === '' || !isComplete || debounced !== trimmed) return null

  // `search` is a broad ILIKE across several columns, so re-check exactly here.
  const matches = (query.data?.results ?? []).filter(
    (c) =>
      c.id !== excludeCustomerId &&
      (c.mobile_number === debounced || c.alt_mobile_number === debounced),
  )
  if (matches.length === 0) return null

  const [first, ...rest] = matches

  return (
    <ErrorBanner severity="warning" variant="standard">
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
        This number is already registered
      </Typography>
      <Typography variant="body2">
        {debounced} belongs to{' '}
        <Box component="span" sx={{ fontWeight: 600 }}>
          <Link
            to="/customers/$customerId"
            params={{ customerId: first.id }}
            target="_blank"
            style={{ color: 'inherit' }}
          >
            {first.full_name}
          </Link>
        </Box>
        {rest.length > 0 && ` and ${rest.length} other customer${rest.length > 1 ? 's' : ''}`}. You
        can still continue — check it is not the same person first.
      </Typography>
    </ErrorBanner>
  )
}
