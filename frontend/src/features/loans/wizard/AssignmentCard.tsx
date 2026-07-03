import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { AxiosError } from 'axios'

import { serverMessage } from '@/api/errors'
import {
  useCustomer,
  useUpdateCustomer,
  type CustomerResponse,
  type CustomerUpdate,
} from '@/api/queries/customers'
import { type EmployeeResponse } from '@/api/queries/employees'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { BranchPointPicker } from '@/features/customers/components/BranchPointPicker'
import { EmployeePicker } from '@/features/customers/components/EmployeePicker'

function mapErr(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = serverMessage(error)
    if (error.response?.status === 403)
      return detail ?? 'You do not have permission to change this assignment.'
    if (detail) return detail
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Could not save the assignment. Please try again.'
}

/**
 * Wizard step card for the customer's branch point and collector assignment.
 * Both live on the customer, so this PATCHes the customer (not the loan).
 * Employees always own the customers they create, so their "Assigned to" is
 * fixed to themselves; only admins get the employee picker.
 */
export function WizardAssignmentCard({ customerId }: { customerId: string }) {
  const customerQuery = useCustomer(customerId)

  if (customerQuery.isLoading) {
    return (
      <Card>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      </Card>
    )
  }
  if (customerQuery.isError || !customerQuery.data) {
    return (
      <Card>
        <ErrorBanner message="Could not load the customer for assignment." />
      </Card>
    )
  }
  return <AssignmentForm customer={customerQuery.data} />
}

function AssignmentForm({ customer }: { customer: CustomerResponse }) {
  const { user } = useAuth()
  const canPickAssignee = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const update = useUpdateCustomer(customer.id)

  const [branch, setBranch] = useState(customer.branch_point ?? '')
  const [assignee, setAssignee] = useState<EmployeeResponse | null>(
    customer.assigned_employee_id
      ? {
          id: customer.assigned_employee_id,
          username: customer.assigned_employee_name ?? '',
          email: '',
          full_name: customer.assigned_employee_name,
          role: 'EMPLOYEE',
          is_active: true,
        }
      : null,
  )

  const onSave = () => {
    const payload: CustomerUpdate = {}
    const nextBranch = branch.trim() === '' ? null : branch.trim()
    if (nextBranch !== (customer.branch_point ?? null)) payload.branch_point = nextBranch
    if (canPickAssignee) {
      const next = assignee?.id ?? null
      if (next !== customer.assigned_employee_id) payload.assigned_employee_id = next
    }
    if (Object.keys(payload).length === 0) return
    update.mutate(payload)
  }

  const error = update.isError ? mapErr(update.error) : null

  return (
    <Card>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Assignment
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The branch point and collector are recorded on the customer.
      </Typography>

      {error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={error} />
        </Box>
      )}
      {update.isSuccess && !error && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="success" variant="outlined" message="Assignment saved." />
        </Box>
      )}

      <Stack spacing={2.5}>
        {canPickAssignee ? (
          <EmployeePicker value={assignee} onChange={setAssignee} />
        ) : (
          <Box>
            <FieldLabel htmlFor="assigned_to_self">Assigned to</FieldLabel>
            <Input
              id="assigned_to_self"
              value={user?.full_name || user?.username || 'You'}
              disabled
              hint="Finances you create are assigned to you."
            />
          </Box>
        )}

        <BranchPointPicker value={branch} onChange={setBranch} />

        <Box>
          <Btn type="button" variant="primary" loading={update.isPending} onClick={onSave}>
            {update.isSuccess ? 'Update assignment' : 'Save assignment'}
          </Btn>
        </Box>
      </Stack>
    </Card>
  )
}
