import type { ChipProps } from '@mui/material/Chip'

import type { UserRole } from '@/schemas/enums'

export const USER_ROLE_META: Record<
  UserRole,
  { label: string; color: NonNullable<ChipProps['color']> }
> = {
  SUPER_ADMIN: { label: 'Super admin', color: 'secondary' },
  ADMIN: { label: 'Admin', color: 'primary' },
  EMPLOYEE: { label: 'Employee', color: 'default' },
}

// Order for the list filter chips. SUPER_ADMIN is intentionally omitted — the
// Team roster excludes super admins (see backend list_users), so a SUPER_ADMIN
// filter would always be empty.
export const USER_ROLE_ORDER: UserRole[] = ['EMPLOYEE', 'ADMIN']
