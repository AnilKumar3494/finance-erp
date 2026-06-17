import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import {
  useReminderLog,
  useReminderSettings,
  useRunReminders,
  useSendTestReminder,
  useUpdateReminderSettings,
  type ReminderStatus,
} from '@/api/queries/reminders'

const PAGE_SIZE = 20

const STATUS_COLOR: Record<ReminderStatus, 'success' | 'error' | 'warning' | 'default'> = {
  SENT: 'success',
  FAILED: 'error',
  SKIPPED: 'warning',
  DRY_RUN: 'default',
}

export function RemindersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  if (!isAdmin) {
    return (
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Typography variant="h2" sx={{ mb: 3 }}>
          Reminders
        </Typography>
        <Card>
          <Typography variant="h3">Restricted</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            WhatsApp reminder settings are available to administrators only.
          </Typography>
        </Card>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        WhatsApp Reminders
      </Typography>
      <Stack spacing={3}>
        <SettingsCard />
        <ToolsCard />
        <LogCard />
      </Stack>
    </Box>
  )
}

// --------------------------------------------------
// Settings
// --------------------------------------------------

function SettingsCard() {
  const query = useReminderSettings()
  const update = useUpdateReminderSettings()

  const [enabled, setEnabled] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateLang, setTemplateLang] = useState('en')
  const [bodyPreview, setBodyPreview] = useState('')
  const [offsets, setOffsets] = useState('')
  const [sendHour, setSendHour] = useState(9)
  const [sendMinute, setSendMinute] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const s = query.data
    if (!s) return
    setEnabled(s.reminders_enabled)
    setTemplateName(s.template_name)
    setTemplateLang(s.template_language)
    setBodyPreview(s.template_body_preview)
    setOffsets(s.reminder_offsets_days.join(', '))
    setSendHour(s.send_hour)
    setSendMinute(s.send_minute)
  }, [query.data])

  const parsedOffsets = useMemo(
    () =>
      offsets
        .split(',')
        .map((o) => Number(o.trim()))
        .filter((o) => Number.isFinite(o) && o >= 0),
    [offsets],
  )

  const offsetsValid = parsedOffsets.length > 0

  const onSave = () => {
    setSaved(false)
    update.mutate(
      {
        reminders_enabled: enabled,
        template_name: templateName,
        template_language: templateLang,
        template_body_preview: bodyPreview,
        reminder_offsets_days: parsedOffsets,
        send_hour: sendHour,
        send_minute: sendMinute,
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  if (query.isLoading) {
    return (
      <Card>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      </Card>
    )
  }

  if (query.isError) {
    return (
      <Card>
        <ErrorBanner message="Could not load reminder settings." />
      </Card>
    )
  }

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Reminders go out the configured number of days before each EMI due date.
        The message wording must match a template approved by Meta — editing the
        preview here is for reference; changing the actual sentence needs
        re-approval (see WHATSAPP_SETUP.md).
      </Typography>

      <Stack spacing={2}>
        <FormControlLabel
          control={
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          }
          label={
            <Typography variant="body2">
              Reminders {enabled ? 'enabled' : 'disabled'} (global on/off)
            </Typography>
          }
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Input
              id="template-name"
              label="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </Box>
          <TextField
            select
            size="small"
            label="Language"
            value={templateLang}
            onChange={(e) => setTemplateLang(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="en">English (en)</MenuItem>
            <MenuItem value="en_US">English US (en_US)</MenuItem>
            <MenuItem value="te">Telugu (te)</MenuItem>
            <MenuItem value="hi">Hindi (hi)</MenuItem>
          </TextField>
        </Stack>

        <TextField
          label="Message preview ({{1}} name, {{2}} amount, {{3}} due date, {{4}} HP no.)"
          value={bodyPreview}
          onChange={(e) => setBodyPreview(e.target.value)}
          multiline
          minRows={2}
          size="small"
          fullWidth
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-end' } }}>
          <Box sx={{ flex: 1 }}>
            <Input
              id="offsets"
              label="Days before due date (comma-separated)"
              value={offsets}
              onChange={(e) => setOffsets(e.target.value)}
              placeholder="7, 3"
            />
          </Box>
          <TextField
            type="number"
            size="small"
            label="Send hour"
            value={sendHour}
            onChange={(e) => setSendHour(Math.max(0, Math.min(23, Number(e.target.value))))}
            sx={{ width: 120 }}
            slotProps={{ htmlInput: { min: 0, max: 23 } }}
          />
          <TextField
            type="number"
            size="small"
            label="Send minute"
            value={sendMinute}
            onChange={(e) => setSendMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
            sx={{ width: 120 }}
            slotProps={{ htmlInput: { min: 0, max: 59 } }}
          />
        </Stack>
        {!offsetsValid && (
          <Typography variant="caption" color="error">
            Enter at least one valid number of days.
          </Typography>
        )}

        {update.isError && <ErrorBanner message="Could not save settings." />}

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Btn
            variant="primary"
            onClick={onSave}
            disabled={!offsetsValid || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save settings'}
          </Btn>
          {saved && !update.isPending && (
            <Typography variant="body2" color="success.main">
              Saved.
            </Typography>
          )}
        </Stack>
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Tools: test send + run now
// --------------------------------------------------

function ToolsCard() {
  const sendTest = useSendTestReminder()
  const run = useRunReminders()
  const [testTo, setTestTo] = useState('')
  const [lastRun, setLastRun] = useState<string | null>(null)

  const onRun = (dryRun: boolean) => {
    setLastRun(null)
    run.mutate(dryRun, {
      onSuccess: (r) => {
        setLastRun(
          `candidates ${r.candidates} · sent ${r.sent} · dry-run ${r.dry_run} · ` +
            `failed ${r.failed} · skipped ${r.skipped} · already-done ${r.already_done}` +
            (r.enabled ? '' : ' (reminders globally OFF)'),
        )
      },
    })
  }

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Tools
      </Typography>

      <Stack spacing={2}>
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Send a test message (uses the configured template + sample values).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Input
                id="test-to"
                placeholder="Phone, e.g. 9876543210"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </Box>
            <Btn
              variant="ghost"
              disabled={!testTo.trim() || sendTest.isPending}
              onClick={() => sendTest.mutate({ to: testTo.trim() })}
            >
              {sendTest.isPending ? 'Sending…' : 'Send test'}
            </Btn>
          </Stack>
          {sendTest.data && (
            <Typography
              variant="body2"
              sx={{ mt: 1 }}
              color={sendTest.data.ok ? 'success.main' : 'error'}
            >
              {sendTest.data.dry_run
                ? `Dry-run: would send to ${sendTest.data.to}.`
                : sendTest.data.ok
                  ? `Sent to ${sendTest.data.to}${sendTest.data.message_id ? ` (id ${sendTest.data.message_id})` : ''}.`
                  : `Failed: ${sendTest.data.error ?? 'unknown error'}`}
            </Typography>
          )}
          {sendTest.isError && <ErrorBanner message="Test send failed." />}
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Run the reminder pass now (normally runs daily on schedule).
          </Typography>
          <Stack direction="row" spacing={2}>
            <Btn variant="ghost" disabled={run.isPending} onClick={() => onRun(true)}>
              Run now (dry-run)
            </Btn>
            <Btn variant="primary" disabled={run.isPending} onClick={() => onRun(false)}>
              Run now (send)
            </Btn>
          </Stack>
          {run.isPending && (
            <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
              Running…
            </Typography>
          )}
          {lastRun && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {lastRun}
            </Typography>
          )}
          {run.isError && <ErrorBanner message="Run failed." />}
        </Box>
      </Stack>
    </Card>
  )
}

// --------------------------------------------------
// Log
// --------------------------------------------------

function LogCard() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<ReminderStatus | undefined>(undefined)
  const query = useReminderLog({ page, page_size: PAGE_SIZE, status })

  const total = query.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  const rows = query.data?.results ?? []

  const statuses: (ReminderStatus | 'ALL')[] = ['ALL', 'SENT', 'DRY_RUN', 'FAILED', 'SKIPPED']

  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Send history
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {statuses.map((s) => {
            const selected = s === 'ALL' ? status === undefined : status === s
            return (
              <Chip
                key={s}
                label={s}
                onClick={() => {
                  setStatus(s === 'ALL' ? undefined : (s as ReminderStatus))
                  setPage(1)
                }}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                size="small"
              />
            )
          })}
        </Stack>
      </Box>

      {query.isLoading && !query.data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <Spinner size={24} />
        </Box>
      ) : rows.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            No reminders logged yet.
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>When</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Offset</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Detail</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip label={r.status} color={STATUS_COLOR[r.status]} size="small" />
                  </TableCell>
                  <TableCell>{r.offset_days}d</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{r.phone ?? '—'}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {r.error ?? r.provider_message_id ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {total > 0 && (
        <Stack
          direction="row"
          spacing={2}
          sx={{ p: 2, alignItems: 'center', justifyContent: 'center' }}
        >
          <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹ Prev
          </Btn>
          <Typography variant="body2" color="text.secondary">
            Page {page} of {totalPages} · {total} {total === 1 ? 'entry' : 'entries'}
          </Typography>
          <Btn
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </Btn>
        </Stack>
      )}
    </Card>
  )
}
