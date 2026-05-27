// Only honor internal paths. Anything that doesn't start with a single '/'
// (or starts with '//' which the browser reads as a protocol-relative URL)
// is rejected to prevent open-redirect attacks.
export function sanitizeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/'
  return target
}
