import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { customerKeys } from '@/api/queries/customers'
import { loanKeys } from '@/api/queries/loans'

// --------------------------------------------------
// Types — mirror backend/app/schemas/whatsapp.py
// --------------------------------------------------

export interface ReminderSettings {
  reminders_enabled: boolean
  template_name: string
  template_language: string
  template_body_preview: string
  reminder_offsets_days: number[]
  send_hour: number
  send_minute: number
  updated_at: string
}

export interface ReminderSettingsUpdate {
  reminders_enabled?: boolean
  template_name?: string
  template_language?: string
  template_body_preview?: string
  reminder_offsets_days?: number[]
  send_hour?: number
  send_minute?: number
}

export interface ReminderRunResult {
  enabled: boolean
  offsets: number[]
  candidates: number
  sent: number
  dry_run: number
  failed: number
  skipped: number
  already_done: number
}

export interface ReminderTestResult {
  ok: boolean
  dry_run: boolean
  to: string | null
  message_id: string | null
  error: string | null
}

export type ReminderStatus = 'SENT' | 'FAILED' | 'SKIPPED' | 'DRY_RUN'

export interface ReminderLogItem {
  id: string
  due_cycle_id: string
  loan_id: string
  customer_id: string
  offset_days: number
  phone: string | null
  status: ReminderStatus
  provider_message_id: string | null
  error: string | null
  created_at: string
}

export interface ReminderLogResponse {
  total: number
  page: number
  page_size: number
  results: ReminderLogItem[]
}

export interface ReminderLogParams {
  status?: ReminderStatus
  customer_id?: string
  page: number
  page_size?: number
}

// --------------------------------------------------
// Query keys
// --------------------------------------------------

export const reminderKeys = {
  all: ['reminders'] as const,
  settings: () => [...reminderKeys.all, 'settings'] as const,
  logs: () => [...reminderKeys.all, 'log'] as const,
  log: (params: ReminderLogParams) => [...reminderKeys.logs(), params] as const,
}

// --------------------------------------------------
// Hooks
// --------------------------------------------------

export function useReminderSettings() {
  return useQuery({
    queryKey: reminderKeys.settings(),
    queryFn: async () => {
      const { data } = await apiClient.get<ReminderSettings>('/reminders/settings')
      return data
    },
  })
}

export function useUpdateReminderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ReminderSettingsUpdate) => {
      const { data } = await apiClient.put<ReminderSettings>(
        '/reminders/settings',
        payload,
      )
      return data
    },
    onSuccess: (updated) => {
      qc.setQueryData(reminderKeys.settings(), updated)
    },
  })
}

export function useReminderLog(params: ReminderLogParams) {
  return useQuery({
    queryKey: reminderKeys.log(params),
    queryFn: async () => {
      const { data } = await apiClient.get<ReminderLogResponse>('/reminders/log', {
        params,
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useRunReminders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data } = await apiClient.post<ReminderRunResult>('/reminders/run-now', null, {
        params: { dry_run: dryRun },
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reminderKeys.logs() })
    },
  })
}

export function useSendTestReminder() {
  return useMutation({
    mutationFn: async (payload: { to: string; variables?: string[] }) => {
      const { data } = await apiClient.post<ReminderTestResult>('/reminders/test', payload)
      return data
    },
  })
}

export function useToggleCustomerReminders(customerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await apiClient.patch(`/reminders/customers/${customerId}`, {
        enabled,
      })
      return data as { id: string; whatsapp_reminders_enabled: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.detail(customerId) })
    },
  })
}

export function useToggleLoanReminders(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await apiClient.patch(`/reminders/loans/${loanId}`, { enabled })
      return data as { id: string; reminders_enabled: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loanKeys.detail(loanId) })
    },
  })
}
