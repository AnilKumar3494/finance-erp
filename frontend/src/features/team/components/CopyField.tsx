import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined'

import { Btn, FieldLabel } from '@/components/primitives'

// Legacy clipboard write for non-secure contexts. `navigator.clipboard` only
// exists over HTTPS/localhost; on a plain-HTTP LAN deployment it's undefined,
// so a hidden-textarea + execCommand keeps the one-time credential copyable.
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// A read-only labelled value with a copy-to-clipboard button. Shared by the
// one-time credential reveal panels (account creation + admin password reset).
export function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const markCopied = () => {
    setFailed(false)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const copy = async () => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        markCopied()
        return
      } catch {
        /* fall through to the legacy path */
      }
    }
    if (legacyCopy(value)) markCopied()
    else setFailed(true)
  }
  return (
    <Box>
      <FieldLabel>{label}</FieldLabel>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.25,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}
        >
          {value}
        </Typography>
        <Btn
          variant="ghost"
          size="sm"
          startIcon={copied ? <CheckCircleIcon /> : <ContentCopyIcon />}
          onClick={copy}
          sx={{ flexShrink: 0 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Btn>
      </Stack>
      {failed && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main' }}>
          Couldn’t copy automatically — select the value above and copy manually.
        </Typography>
      )}
    </Box>
  )
}
