import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFileOutlined'

import { useDocumentDownloadUrl, type DocumentResponse } from '@/api/queries/documents'
import { Btn } from '@/components/primitives'

// Read-only row for a single document: name, optional label/meta, and a View
// button that opens a short-lived presigned URL. Used wherever a user can see
// a document but not replace it.
export function DocumentLine({
  doc,
  label,
}: {
  doc: DocumentResponse
  label?: string
}) {
  const download = useDocumentDownloadUrl()
  const open = () =>
    download.mutate(doc.id, {
      onSuccess: ({ download_url }) => window.open(download_url, '_blank', 'noopener'),
    })

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: 'center',
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <InsertDriveFileIcon sx={{ color: 'text.secondary' }} fontSize="small" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {label && (
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        )}
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {doc.file_name ?? 'Document'}
        </Typography>
        {doc.file_size_display && (
          <Typography variant="caption" color="text.secondary">
            {doc.file_size_display}
          </Typography>
        )}
      </Box>
      <Btn variant="ghost" size="sm" onClick={open} loading={download.isPending}>
        View
      </Btn>
    </Stack>
  )
}
