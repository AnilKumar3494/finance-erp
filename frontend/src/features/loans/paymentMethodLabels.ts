import type { PaymentMethod } from '@/schemas/enums'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GPAY: 'Google Pay',
  PHONEPE: 'PhonePe',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
}
