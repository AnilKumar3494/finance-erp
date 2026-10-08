import Typography from '@mui/material/Typography'

import { Card } from '@/components/primitives'
import { FieldGrid, FieldRow } from '@/components/DetailFields'
import { fmtDateTime } from '@/lib/format'

// The actor shape every response nests (backend schemas/user.py UserNested).
export interface AuditActor {
  id: string
  username: string
  full_name?: string | null
}

export interface AuditCardProps {
  created_at?: string | null
  updated_at?: string | null
  created_by?: AuditActor | null
  updated_by?: AuditActor | null
  // Raw ids, used only as a fallback when the nested actor was not loaded.
  created_by_id?: string | null
  updated_by_id?: string | null
  // Extra rows rendered above the timestamps — e.g. the finance's approval date.
  children?: React.ReactNode
}

// Prefer the person's name; fall back to their username, then to the bare id so
// a record whose actor was never eager-loaded still shows *something* traceable.
function auditActorName(
  actor: AuditActor | null | undefined,
  fallbackId: string | null | undefined,
): string | undefined {
  if (actor) return actor.full_name?.trim() || actor.username
  return fallbackId ?? undefined
}

// Who created a record and who last touched it, with both timestamps in IST.
// Shared by the finance, customer and vehicle detail pages so the three read
// identically.
export function AuditCard({
  created_at,
  updated_at,
  created_by,
  updated_by,
  created_by_id,
  updated_by_id,
  children,
}: AuditCardProps) {
  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Audit
      </Typography>
      <FieldGrid>
        {children}
        <FieldRow label="Created at" value={fmtDateTime(created_at)} />
        <FieldRow label="Last updated" value={fmtDateTime(updated_at)} />
        <FieldRow label="Created by" value={auditActorName(created_by, created_by_id)} />
        <FieldRow label="Updated by" value={auditActorName(updated_by, updated_by_id)} />
      </FieldGrid>
    </Card>
  )
}
