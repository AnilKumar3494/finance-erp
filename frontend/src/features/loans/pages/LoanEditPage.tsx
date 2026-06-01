interface LoanEditPageProps {
  loanId: string
}

export function LoanEditPage({ loanId }: LoanEditPageProps) {
  return <div>Edit loan {loanId}</div>
}
