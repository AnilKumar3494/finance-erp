import { useRef } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import PrintIcon from '@mui/icons-material/PrintOutlined'

import { Btn } from '@/components/primitives'

// An in-app preview of the customer statement. The statement HTML is rendered
// into a sandboxed iframe so the user can read it in full before deciding to
// print or save it as PDF — the fix for "the client wants to see a preview
// before printing". Printing goes through the iframe's own print(), which
// prints just the statement and, crucially, is NOT a pop-up, so no blocker can
// swallow it the way the old window.open flow could.
export function StatementPreviewDialog({
  open,
  onClose,
  html,
}: {
  open: boolean
  onClose: () => void
  html: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handlePrint = () => {
    const frame = iframeRef.current
    if (!frame?.contentWindow) return
    frame.contentWindow.focus()
    frame.contentWindow.print()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Customer statement preview</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box
          component="iframe"
          ref={iframeRef}
          title="Customer statement preview"
          srcDoc={html}
          // Statements are printed on white paper — pin a white backdrop so the
          // preview matches the printout regardless of the app theme.
          sx={{ width: '100%', height: '72vh', border: 0, display: 'block', bgcolor: '#fff' }}
        />
      </DialogContent>
      <DialogActions>
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
        <Btn variant="primary" startIcon={<PrintIcon />} onClick={handlePrint}>
          Print / Save as PDF
        </Btn>
      </DialogActions>
    </Dialog>
  )
}
