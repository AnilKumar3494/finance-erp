import { useEffect, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import EditIcon from '@mui/icons-material/EditOutlined'

import { Btn, Card, ErrorBanner } from '@/components/primitives'

interface EditableSectionProps {
  title: string
  subtitle?: ReactNode
  // Whether the Edit button is shown. Editing is still in-place even if false.
  canEdit: boolean
  // Shown as a warning banner while editing (e.g. admin override on a closed loan).
  warning?: string
  // Read-only content for the section.
  view: ReactNode
  // Editor content. Call `done()` to leave edit mode (on save or cancel).
  edit: (done: () => void) => ReactNode
  // Always-visible content rendered below the view/editor, separated by a rule.
  // Used for document upload/replace areas that are not gated by the toggle.
  footer?: ReactNode
  editLabel?: string
  // DOM id for the section card, used as a scroll anchor (e.g. the approval
  // checklist jumping to an incomplete section).
  sectionId?: string
  // Bump this number to imperatively open the editor and scroll the section
  // into view — the approval "walk-through" uses it to focus a section.
  openSignal?: number
  // Labels of fields this section is missing for approval. When present, the
  // section is flagged (warning banner + yellow Edit button).
  missing?: string[]
}

// A section card with a single in-place view↔edit toggle. The Edit button is
// rendered only when `canEdit`; the editor receives a `done` callback to close
// itself after a successful save or a cancel.
export function EditableSection({
  title,
  subtitle,
  canEdit,
  warning,
  view,
  edit,
  footer,
  editLabel = 'Edit',
  sectionId,
  openSignal,
  missing,
}: EditableSectionProps) {
  const [editing, setEditing] = useState(false)
  const done = () => setEditing(false)
  const incomplete = !!missing?.length

  // Focus request from the approval checklist: open the editor (when editable)
  // and scroll the section into view.
  useEffect(() => {
    if (openSignal === undefined) return
    if (canEdit) setEditing(true)
    if (sectionId) {
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [openSignal, canEdit, sectionId])

  return (
    <Card
      id={sectionId}
      sx={incomplete ? { borderColor: 'var(--warning)' } : undefined}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {canEdit && !editing && (
          <Btn
            variant="ghost"
            size="sm"
            startIcon={<EditIcon />}
            onClick={() => setEditing(true)}
            sx={
              incomplete
                ? {
                    flexShrink: 0,
                    color: 'var(--warning)',
                    bgcolor: 'var(--warning-light)',
                    '&:hover': { bgcolor: 'var(--warning-light)' },
                  }
                : { flexShrink: 0 }
            }
          >
            {editLabel}
          </Btn>
        )}
      </Stack>

      {incomplete && !editing && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner
            severity="warning"
            variant="outlined"
            message={`Required for approval: ${missing!.join(', ')}`}
          />
        </Box>
      )}

      {editing ? (
        <>
          {warning && (
            <Box sx={{ mb: 2 }}>
              <ErrorBanner severity="warning" variant="outlined" message={warning} />
            </Box>
          )}
          {edit(done)}
        </>
      ) : (
        view
      )}

      {footer && (
        <>
          <Divider sx={{ my: 2.5 }} />
          {footer}
        </>
      )}
    </Card>
  )
}
