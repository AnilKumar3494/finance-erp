import { createFileRoute } from '@tanstack/react-router'

import { IrrSheetPage } from '@/features/loans/pages/IrrSheetPage'

export const Route = createFileRoute('/_authed/irr-sheet')({
  staticData: { title: 'IRR Sheet' },
  component: IrrSheetPage,
})
