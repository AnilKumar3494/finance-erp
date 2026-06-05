import { useId, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CloudUploadIcon from '@mui/icons-material/CloudUploadOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined'

import {
  useUploadDocument,
  useDocumentDownloadUrl,
  type DocumentResponse,
} from '@/api/queries/documents'
import type { DocCategory } from '@/schemas/enums'
import { Btn, ErrorBanner, FieldLabel, Spinner } from '@/components/primitives'
import { fmtSize } from '@/lib/format'

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.txt', '.webp']
const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = ALLOWED_EXTENSIONS.join(',')

function validate(file: File): string | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
  }
  if (file.size > MAX_BYTES) {
    return `File is too large (max ${fmtSize(MAX_BYTES)}).`
  }
  return null
}

function mapUploadError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail
    if (status === 400) return detail ?? 'Invalid file. Please choose another.'
    if (status === 403) return detail ?? 'You do not have permission to upload here.'
    if (status === 413) return 'File is too large.'
    if (status === 429) return 'Too many uploads. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Upload failed. Please try again.'
}

interface FileUploadProps {
  customerId: string
  docType: DocCategory
  loanId?: string
  vehicleId?: string
  label?: string
  required?: boolean
  hint?: string
  initialDocument?: DocumentResponse | null
  onUploaded?: (doc: DocumentResponse) => void
}

export function FileUpload({
  customerId,
  docType,
  loanId,
  vehicleId,
  label,
  required,
  hint,
  initialDocument = null,
  onUploaded,
}: FileUploadProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploaded, setUploaded] = useState<DocumentResponse | null>(initialDocument)
  const [validationError, setValidationError] = useState<string>()
  const [dragOver, setDragOver] = useState(false)

  const upload = useUploadDocument()
  const downloadUrl = useDocumentDownloadUrl()

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const err = validate(file)
    if (err) {
      setValidationError(err)
      return
    }
    setValidationError(undefined)
    upload.mutate(
      { customer_id: customerId, doc_type: docType, file, loan_id: loanId, vehicle_id: vehicleId },
      {
        onSuccess: (doc) => {
          setUploaded(doc)
          onUploaded?.(doc)
        },
      },
    )
  }

  const openPicker = () => inputRef.current?.click()

  const view = () => {
    if (!uploaded) return
    downloadUrl.mutate(uploaded.id, {
      onSuccess: ({ download_url }) => window.open(download_url, '_blank', 'noopener'),
    })
  }

  const error = validationError ?? (upload.isError ? mapUploadError(upload.error) : undefined)

  return (
    <Box>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}

      {uploaded ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 1.5,
            border: '1px solid',
            borderColor: 'success.main',
            borderRadius: 'var(--radius-sm)',
            bgcolor: 'var(--surface-alt)',
          }}
        >
          <CheckCircleIcon sx={{ color: 'success.main' }} fontSize="small" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }} noWrap>
              {uploaded.file_name ?? 'Uploaded file'}
            </Typography>
            {uploaded.file_size_display && (
              <Typography variant="caption" color="text.secondary">
                {uploaded.file_size_display}
              </Typography>
            )}
          </Box>
          <Btn variant="ghost" size="sm" onClick={view} loading={downloadUrl.isPending}>
            View
          </Btn>
          <Btn variant="ghost" size="sm" onClick={openPicker} disabled={upload.isPending}>
            Replace
          </Btn>
        </Box>
      ) : (
        <Box
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPicker()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            p: 3,
            minHeight: 96,
            cursor: upload.isPending ? 'default' : 'pointer',
            border: '1.5px dashed',
            borderColor: dragOver ? 'primary.main' : 'var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            bgcolor: dragOver ? 'var(--surface-alt)' : 'transparent',
            transition: 'border-color var(--t-fast), background-color var(--t-fast)',
            '&:hover': { borderColor: 'primary.main' },
          }}
        >
          {upload.isPending ? (
            <>
              <Spinner size={22} />
              <Typography variant="body2" color="text.secondary">
                Uploading…
              </Typography>
            </>
          ) : (
            <>
              <CloudUploadIcon sx={{ color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                Click to upload or drag a file here
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {hint ?? `PDF, image, or document · max ${fmtSize(MAX_BYTES)}`}
              </Typography>
            </>
          )}
        </Box>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      {error && (
        <Box sx={{ mt: 1 }}>
          <ErrorBanner message={error} severity="error" variant="outlined" />
        </Box>
      )}
    </Box>
  )
}
