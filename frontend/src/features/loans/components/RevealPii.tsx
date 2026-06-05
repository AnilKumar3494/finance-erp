import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'

import { Btn, ErrorBanner } from '@/components/primitives'

export interface UnmaskedPII {
  aadhaar_number: string | null
  pan_number: string | null
}

// Shows the current (masked) Aadhaar/PAN on file with a Reveal button. Reveal
// opens a confirm dialog and, on confirm, calls the entity's unmask mutation —
// which is audited server-side. Mirrors the rules of the customers module.
export function RevealPii({
  maskedAadhaar,
  maskedPan,
  unmask,
  pending,
  error,
}: {
  maskedAadhaar: string | null
  maskedPan: string | null
  unmask: (onSuccess: (pii: UnmaskedPII) => void) => void
  pending: boolean
  error?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState<UnmaskedPII | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const canReveal = maskedAadhaar !== null || maskedPan !== null

  const openDialog = () => {
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
      document.activeElement.blur()
    }
    setOpen(true)
  }
  const closeDialog = () => {
    setOpen(false)
    const t = triggerRef.current
    triggerRef.current = null
    if (t) requestAnimationFrame(() => t.focus())
  }
  const confirm = () =>
    unmask((pii) => {
      setRevealed(pii)
      closeDialog()
    })

  const aadhaar = revealed?.aadhaar_number ?? maskedAadhaar
  const pan = revealed?.pan_number ?? maskedPan

  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 'var(--radius-sm)',
        bgcolor: 'var(--surface-alt)',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Current on file
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)' }}>
            Aadhaar: {aadhaar ?? 'Not on file'}
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)' }}>
            PAN: {pan ?? 'Not on file'}
          </Typography>
        </Box>
        {canReveal && !revealed && (
          <Btn variant="ghost" size="sm" startIcon={<VisibilityIcon />} onClick={openDialog} sx={{ flexShrink: 0 }}>
            Reveal
          </Btn>
        )}
      </Stack>

      {error && !open && (
        <Box sx={{ mt: 1 }}>
          <ErrorBanner message={error} severity="error" variant="outlined" />
        </Box>
      )}

      <Dialog open={open} onClose={pending ? undefined : closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Reveal sensitive data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Showing the full Aadhaar and PAN is logged in the audit trail for
            compliance. Continue only if you have a legitimate business reason.
          </Typography>
          {error && (
            <Box sx={{ mt: 2 }}>
              <ErrorBanner message={error} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Btn variant="ghost" onClick={closeDialog} disabled={pending}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={confirm} loading={pending}>
            Reveal &amp; log
          </Btn>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
