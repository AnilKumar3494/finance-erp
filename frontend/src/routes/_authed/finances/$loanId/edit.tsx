import { createFileRoute, redirect } from '@tanstack/react-router'

// Editing is now in-place on the finance detail page; this route redirects
// there for any existing links/bookmarks.
export const Route = createFileRoute('/_authed/finances/$loanId/edit')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/finances/$loanId', params: { loanId: params.loanId } })
  },
})
