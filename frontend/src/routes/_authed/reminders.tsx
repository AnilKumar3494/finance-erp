import { createFileRoute } from '@tanstack/react-router'

import { RemindersPage } from '@/features/reminders/pages/RemindersPage'

export const Route = createFileRoute('/_authed/reminders')({
  staticData: { title: 'Reminders' },
  component: RemindersPage,
})
