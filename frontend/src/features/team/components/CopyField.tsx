import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined'

import { Btn, FieldLabel } from '@/components/primitives'

// A read-only labelled value with a copy-to-clipboard button. Shared by the
// one-time credential reveal panels (account creation + admin password reset).
export function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
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
    </Box>
  )
}
