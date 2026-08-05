import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { serverMessage } from '@/api/errors'
import dayjs from 'dayjs'
import { z } from 'zod'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

import {
  useCustomer,
  useUpdateCustomer,
  type CustomerResponse,
  type CustomerUpdate,
} from '@/api/queries/customers'
import { useEmployees, type EmployeeResponse } from '@/api/queries/employees'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, FieldLabel, Input, Spinner } from '@/components/primitives'
import { BranchPointPicker } from '@/features/customers/components/BranchPointPicker'
import { DuplicateMobileWarning } from '@/features/customers/components/DuplicateMobileWarning'
import { EmployeePicker } from '@/features/customers/components/EmployeePicker'
import { AADHAAR_RE, MOBILE_RE, PAN_RE, PIN_RE, optionalDate } from '@/schemas/primitives'

// --------------------------------------------------
// Validation — identical to create, but Aadhaar/PAN here use
// "leave blank = keep current" semantics: empty = no change.
// --------------------------------------------------

const optionalFormat = (re: RegExp, msg: string) =>
  z.string().refine((v) => v === '' || re.test(v), msg)

const Schema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must be 255 characters or fewer'),
  mobile_number: z
    .string()
    .regex(MOBILE_RE, 'Enter a 10-digit mobile number starting with 6, 7, 8, or 9'),
  alt_mobile_number: optionalFormat(
    MOBILE_RE,
    'Enter a 10-digit mobile number starting with 6, 7, 8, or 9',
  ),
  aadhaar_number: optionalFormat(AADHAAR_RE, 'Aadhaar must be exactly 12 digits'),
  pan_number: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || PAN_RE.test(v), {
      message: 'PAN must be in the format AAAAA9999A',
    }),
  date_of_birth: optionalDate.refine(
    (v) => v === null || v.isBefore(dayjs().add(1, 'day')),
    'Date of birth cannot be in the future',
  ),
  address_line_1: z.string().max(500, 'Address must be 500 characters or fewer'),
  address_line_2: z.string().max(500, 'Address must be 500 characters or fewer'),
  mandal_village: z.string().max(100, 'Must be 100 characters or fewer'),
  pincode: optionalFormat(PIN_RE, 'PIN code must be 6 digits and cannot start with 0'),
  remarks: z.string(),
  branch_point: z.string().max(100, 'Must be 100 characters or fewer'),
})

type FormValues = z.infer<typeof Schema>

const EMPTY_DEFAULTS: FormValues = {
  full_name: '',
  mobile_number: '',
  alt_mobile_number: '',
  aadhaar_number: '',
  pan_number: '',
  date_of_birth: null,
  address_line_1: '',
  address_line_2: '',
  mandal_village: '',
  pincode: '',
  remarks: '',
  branch_point: '',
}

function defaultsFromCustomer(c: CustomerResponse): FormValues {
  return {
    full_name: c.full_name,
    mobile_number: c.mobile_number,
    alt_mobile_number: c.alt_mobile_number ?? '',
    // Aadhaar/PAN come masked on the wire — never seed the form with them.
    aadhaar_number: '',
    pan_number: '',
    date_of_birth: c.date_of_birth ? dayjs(c.date_of_birth) : null,
    address_line_1: c.address_line_1 ?? '',
    address_line_2: c.address_line_2 ?? '',
    mandal_village: c.mandal_village ?? '',
    pincode: c.pincode ?? '',
    remarks: c.remarks ?? '',
    branch_point: c.branch_point ?? '',
  }
}

// --------------------------------------------------
// Error mapping
// --------------------------------------------------

function mapEditError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const detail = serverMessage(error)
    if (status === 403) {
      return detail ?? 'You do not have permission to edit this customer.'
    }
    if (status === 404) return 'Customer not found.'
    if (status === 409) {
      return detail ?? 'A customer with these details already exists.'
    }
    if (status === 422) {
      return detail ?? 'Please check the highlighted fields and try again.'
    }
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK')
      return 'Cannot reach server. Check your connection and try again.'
  }
  return 'Something went wrong saving changes. Please try again.'
}

// --------------------------------------------------
// Page
// --------------------------------------------------

interface CustomerEditPageProps {
  customerId: string
}

export function CustomerEditPage({ customerId }: CustomerEditPageProps) {
  const navigate = useNavigate()
  const customerQuery = useCustomer(customerId)

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {customerQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : customerQuery.isError ? (
        <ErrorBanner message={mapEditError(customerQuery.error)} />
      ) : customerQuery.data ? (
        <EditForm
          customer={customerQuery.data}
          onCancel={() =>
            navigate({
              to: '/customers/$customerId',
              params: { customerId },
            })
          }
          onSaved={() =>
            navigate({
              to: '/customers/$customerId',
              params: { customerId },
            })
          }
        />
      ) : null}
    </Box>
  )
}

// --------------------------------------------------
// Form
// --------------------------------------------------

interface EditFormProps {
  customer: CustomerResponse
  onCancel: () => void
  onSaved: () => void
}

function EditForm({ customer, onCancel, onSaved }: EditFormProps) {
  const { user } = useAuth()
  const canPickAssignee = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const updateMutation = useUpdateCustomer(customer.id)

  // Seed assignee from current value. We hydrate the EmployeeResponse via
  // useEmployees(...) below — passing a one-off `enabled=true` filter that
  // returns only the assigned user when there is one.
  const [assignee, setAssignee] = useState<EmployeeResponse | null>(null)
  const [assigneeTouched, setAssigneeTouched] = useState(false)

  // Hydrate the assignee Autocomplete value from the customer's current
  // assignment. /auth/employees doesn't accept id-filtering, so we fetch a
  // small page and match locally. If not present in the page, we synthesize
  // a minimal EmployeeResponse from the embedded name so the picker shows
  // something sensible until the user picks differently.
  const employeesQuery = useEmployees({ page_size: 50 }, canPickAssignee)
  useEffect(() => {
    if (!canPickAssignee || assigneeTouched) return
    if (customer.assigned_employee_id === null) {
      setAssignee(null)
      return
    }
    const match = employeesQuery.data?.results.find((e) => e.id === customer.assigned_employee_id)
    if (match) {
      setAssignee(match)
    } else if (customer.assigned_employee_name) {
      // Placeholder so the input isn't blank while the real user is unknown.
      setAssignee({
        id: customer.assigned_employee_id,
        username: customer.assigned_employee_name,
        email: '',
        full_name: customer.assigned_employee_name,
        role: 'EMPLOYEE',
        is_active: true,
      })
    }
  }, [
    canPickAssignee,
    assigneeTouched,
    customer.assigned_employee_id,
    customer.assigned_employee_name,
    employeesQuery.data,
  ])

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: defaultsFromCustomer(customer) ?? EMPTY_DEFAULTS,
  })

  // Advisory only — a reused number is allowed (migration 022). Excludes this
  // customer so an unchanged number never warns about itself.
  const mobileValue = useWatch({ control, name: 'mobile_number' })

  const [noChanges, setNoChanges] = useState(false)

  const onSubmit = (values: FormValues) => {
    setNoChanges(false)
    const payload = buildDiffPayload({
      values,
      original: customer,
      assignee,
      canPickAssignee,
      assigneeTouched,
    })

    if (Object.keys(payload).length === 0) {
      setNoChanges(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    updateMutation.mutate(payload, {
      onSuccess: () => onSaved(),
      onError: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    })
  }

  const submitError = updateMutation.isError ? mapEditError(updateMutation.error) : null

  const aadhaarHint =
    customer.aadhaar_number !== null
      ? `Current: ${customer.aadhaar_number}. Leave blank to keep.`
      : 'Optional'
  const panHint =
    customer.pan_number !== null
      ? `Current: ${customer.pan_number}. Leave blank to keep.`
      : 'Optional'

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={submitError} />
        </Box>
      )}
      {noChanges && !submitError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner severity="info" variant="outlined" message="No changes to save." />
        </Box>
      )}

      <Stack spacing={3}>
        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Personal Info
          </Typography>
          <Stack spacing={2.5}>
            <Input
              id="full_name"
              label="Full name"
              required
              autoComplete="off"
              {...register('full_name')}
              error={errors.full_name?.message}
            />
            <TwoColumn>
              <Input
                id="mobile_number"
                label="Mobile number"
                required
                inputMode="numeric"
                autoComplete="off"
                {...register('mobile_number')}
                error={errors.mobile_number?.message}
              />
              <Input
                id="alt_mobile_number"
                label="Alternate mobile"
                placeholder="Optional"
                inputMode="numeric"
                autoComplete="off"
                {...register('alt_mobile_number')}
                error={errors.alt_mobile_number?.message}
              />
            </TwoColumn>

            <DuplicateMobileWarning mobile={mobileValue} excludeCustomerId={customer.id} />
            <TwoColumn>
              <Controller
                control={control}
                name="date_of_birth"
                render={({ field, fieldState }) => (
                  <Box>
                    <FieldLabel htmlFor="date_of_birth">Date of birth</FieldLabel>
                    <DatePicker
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      format="DD MMM YYYY"
                      maxDate={dayjs()}
                      // DoB is often decades back. Open the year picker first
                      // so users don't paginate months manually. Calendar
                      // input still accepts manual text entry (e.g.
                      // "15 Jan 1985") via the underlying TextField.
                      views={['year', 'month', 'day']}
                      openTo="year"
                      slotProps={{
                        textField: {
                          id: 'date_of_birth',
                          size: 'small',
                          fullWidth: true,
                          error: !!fieldState.error,
                        },
                      }}
                    />
                    {fieldState.error?.message && (
                      <Typography
                        role="alert"
                        sx={{
                          mt: 0.5,
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'error.main',
                        }}
                      >
                        {fieldState.error.message}
                      </Typography>
                    )}
                  </Box>
                )}
              />
              <Box />
            </TwoColumn>
            <TwoColumn>
              <Input
                id="aadhaar_number"
                label="Aadhaar number"
                placeholder={aadhaarHint.split('. ')[0]}
                inputMode="numeric"
                autoComplete="off"
                hint={customer.aadhaar_number !== null ? aadhaarHint : undefined}
                {...register('aadhaar_number')}
                error={errors.aadhaar_number?.message}
              />
              <Input
                id="pan_number"
                label="PAN"
                placeholder={panHint.split('. ')[0]}
                autoComplete="off"
                hint={customer.pan_number !== null ? panHint : undefined}
                {...register('pan_number')}
                error={errors.pan_number?.message}
              />
            </TwoColumn>
          </Stack>
        </Card>

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Address
          </Typography>
          <Stack spacing={2.5}>
            <Input
              id="address_line_1"
              label="Address line 1"
              placeholder="Optional"
              {...register('address_line_1')}
              error={errors.address_line_1?.message}
            />
            <Input
              id="address_line_2"
              label="Address line 2"
              placeholder="Optional"
              {...register('address_line_2')}
              error={errors.address_line_2?.message}
            />
            <TwoColumn>
              <Input
                id="mandal_village"
                label="Mandal / Village"
                placeholder="Optional"
                {...register('mandal_village')}
                error={errors.mandal_village?.message}
              />
              <Input
                id="pincode"
                label="PIN code"
                placeholder="6 digits"
                inputMode="numeric"
                {...register('pincode')}
                error={errors.pincode?.message}
              />
            </TwoColumn>
          </Stack>
        </Card>

        {canPickAssignee && (
          <Card>
            <Typography variant="h3" sx={{ mb: 2 }}>
              Assignment
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Clear the picker to unassign. Customers can be reassigned at any time.
            </Typography>
            <EmployeePicker
              value={assignee}
              onChange={(e) => {
                setAssigneeTouched(true)
                setAssignee(e)
              }}
            />
            <Box sx={{ mt: 2.5 }}>
              <Controller
                control={control}
                name="branch_point"
                render={({ field }) => (
                  <BranchPointPicker
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.branch_point?.message}
                  />
                )}
              />
            </Box>
          </Card>
        )}

        <Card>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Remarks
          </Typography>
          <Input
            id="remarks"
            placeholder="Any notes about this customer (optional)"
            multiline
            minRows={3}
            maxRows={8}
            {...register('remarks')}
            error={errors.remarks?.message}
          />
        </Card>

        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'flex-end' }}
        >
          <Btn type="button" variant="ghost" onClick={onCancel} disabled={updateMutation.isPending}>
            Cancel
          </Btn>
          <Btn type="submit" variant="primary" loading={updateMutation.isPending}>
            Save changes
          </Btn>
        </Stack>
      </Stack>
    </Box>
  )
}

// --------------------------------------------------
// Diff-based payload builder. Only fields that actually changed are sent,
// so the backend (model_dump(exclude_unset=True)) skips no-op updates and
// avoids writing redundant audit rows.
// --------------------------------------------------

interface BuildPayloadArgs {
  values: FormValues
  original: CustomerResponse
  assignee: EmployeeResponse | null
  canPickAssignee: boolean
  // Whether the user has actually interacted with the assignee picker.
  // Without this gate, an unrelated edit submitted before /auth/employees
  // hydration finishes would compute `assignee=null` against a non-null
  // original assignee, sending `assigned_employee_id: null` and silently
  // unassigning the customer.
  assigneeTouched: boolean
}

function buildDiffPayload({
  values,
  original,
  assignee,
  canPickAssignee,
  assigneeTouched,
}: BuildPayloadArgs): CustomerUpdate {
  const payload: CustomerUpdate = {}

  const trimmedName = values.full_name.trim()
  if (trimmedName !== original.full_name) payload.full_name = trimmedName

  if (values.mobile_number !== original.mobile_number) {
    payload.mobile_number = values.mobile_number
  }

  const nullable = (
    field:
      | 'alt_mobile_number'
      | 'address_line_1'
      | 'address_line_2'
      | 'mandal_village'
      | 'pincode'
      | 'remarks'
      | 'branch_point',
    formValue: string,
  ) => {
    const next = formValue.trim() === '' ? null : formValue.trim()
    if (next !== original[field]) payload[field] = next
  }

  nullable('alt_mobile_number', values.alt_mobile_number)
  nullable('address_line_1', values.address_line_1)
  nullable('address_line_2', values.address_line_2)
  nullable('mandal_village', values.mandal_village)
  nullable('pincode', values.pincode)
  nullable('remarks', values.remarks)
  nullable('branch_point', values.branch_point)

  // PII: empty input = "keep current" (cannot compare against the masked
  // wire value). Non-empty = send the new value.
  const aad = values.aadhaar_number.trim()
  if (aad !== '') payload.aadhaar_number = aad
  const pan = values.pan_number.trim().toUpperCase()
  if (pan !== '') payload.pan_number = pan

  const dob = values.date_of_birth ? values.date_of_birth.format('YYYY-MM-DD') : null
  if (dob !== original.date_of_birth) {
    payload.date_of_birth = dob
  }

  if (canPickAssignee && assigneeTouched) {
    const next = assignee?.id ?? null
    if (next !== original.assigned_employee_id) {
      payload.assigned_employee_id = next
    }
  }

  return payload
}

function TwoColumn({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: 2.5,
      }}
    >
      {children}
    </Box>
  )
}
