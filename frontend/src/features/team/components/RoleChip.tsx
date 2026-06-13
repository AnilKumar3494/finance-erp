import Chip from '@mui/material/Chip'

import type { UserRole } from '@/schemas/enums'
import { USER_ROLE_META } from '../userRoleMeta'

export function RoleChip({ role, size = 'small' }: { role: UserRole; size?: 'small' | 'medium' }) {
  const meta = USER_ROLE_META[role]
  return <Chip size={size} label={meta.label} color={meta.color} sx={{ fontWeight: 500 }} />
}
