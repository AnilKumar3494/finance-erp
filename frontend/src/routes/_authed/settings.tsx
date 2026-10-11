import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage } from '@/features/settings/pages/SettingsPage'

export const Route = createFileRoute('/_authed/settings')({
  staticData: { title: 'Settings' },
  component: SettingsPage,
})
